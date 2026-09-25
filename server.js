'use strict';

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

// Load .env if present (Node >= 20.12)
try {
  process.loadEnvFile(path.join(__dirname, '.env'));
} catch {
  // no .env file — rely on real environment variables
}

const PORT = Number(process.env.PORT) || 3000;
const API_KEY = process.env.OPENAI_API_KEY;
const MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini';
const BASE_URL = (process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1').replace(/\/+$/, '');
const NAME = process.env.NAME || 'bzez';
const IDENTITY_PROMPT =
  process.env.IDENTITY_PROMPT ||
  `You are ${NAME}. If asked who you are, who made you, or which model or company ` +
    `is behind you, answer only that you are ${NAME} and that you can't share details ` +
    `about the underlying technology. Never say you are ChatGPT or GPT, and never ` +
    `mention OpenAI.`;
const SYSTEM_PROMPT = `${IDENTITY_PROMPT}\n\n${
  process.env.SYSTEM_PROMPT ||
  'You are a helpful, friendly conversational partner. Answer clearly and concisely.'
}`;

const PUBLIC_DIR = path.join(__dirname, 'public');
const MAX_BODY_BYTES = 200 * 1024;
const MAX_MESSAGES = 40;
const MAX_MESSAGE_CHARS = 8000;

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

if (!API_KEY) {
  console.warn('[warn] OPENAI_API_KEY is not set — /api/messages will return errors.');
}

function sendJson(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(Object.assign(new Error('Payload too large'), { status: 413 }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

// The browser uses neutral roles ("user" / "reply"); map them to the upstream format here.
function toUpstreamMessages(messages) {
  if (!Array.isArray(messages) || messages.length === 0) return null;
  const mapped = [];
  for (const m of messages.slice(-MAX_MESSAGES)) {
    if (!m || typeof m.text !== 'string') return null;
    const text = m.text.slice(0, MAX_MESSAGE_CHARS);
    if (m.role === 'user') mapped.push({ role: 'user', content: text });
    else if (m.role === 'reply') mapped.push({ role: 'assistant', content: text });
    else return null;
  }
  if (mapped[mapped.length - 1].role !== 'user') return null;
  return [{ role: 'system', content: SYSTEM_PROMPT }, ...mapped];
}

async function handleMessage(req, res) {
  let payload;
  try {
    payload = JSON.parse(await readBody(req));
  } catch (err) {
    return sendJson(res, err.status || 400, { error: 'Invalid request.' });
  }

  const messages = toUpstreamMessages(payload && payload.messages);
  if (!messages) return sendJson(res, 400, { error: 'Invalid conversation.' });
  if (!API_KEY) return sendJson(res, 503, { error: 'Service is not configured.' });

  const controller = new AbortController();
  res.on('close', () => controller.abort());

  let upstream;
  try {
    upstream = await fetch(`${BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${API_KEY}`,
      },
      body: JSON.stringify({ model: MODEL, messages, stream: true }),
      signal: controller.signal,
    });
  } catch (err) {
    if (controller.signal.aborted) return;
    console.error('[upstream] request failed:', err.message);
    return sendJson(res, 502, { error: 'Service temporarily unavailable.' });
  }

  if (!upstream.ok || !upstream.body) {
    const detail = await upstream.text().catch(() => '');
    console.error(`[upstream] ${upstream.status}: ${detail.slice(0, 500)}`);
    return sendJson(res, 502, { error: 'Service temporarily unavailable.' });
  }

  // Stream plain text back to the browser — no provider metadata is forwarded.
  res.writeHead(200, {
    'Content-Type': 'text/plain; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    'X-Accel-Buffering': 'no',
  });

  const decoder = new TextDecoder();
  let buffer = '';
  try {
    for await (const chunk of upstream.body) {
      buffer += decoder.decode(chunk, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop();
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith('data:')) continue;
        const data = trimmed.slice(5).trim();
        if (data === '[DONE]') continue;
        try {
          const delta = JSON.parse(data).choices?.[0]?.delta?.content;
          if (delta) res.write(delta);
        } catch {
          // ignore malformed keep-alive lines
        }
      }
    }
  } catch (err) {
    if (!controller.signal.aborted) console.error('[upstream] stream error:', err.message);
  }
  res.end();
}

function serveStatic(req, res) {
  const urlPath = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  const relative = urlPath === '/' ? 'index.html' : urlPath.replace(/^\/+/, '');
  const filePath = path.normalize(path.join(PUBLIC_DIR, relative));

  if (!filePath.startsWith(PUBLIC_DIR + path.sep)) {
    res.writeHead(403);
    return res.end('Forbidden');
  }

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end('Not found');
    }
    res.writeHead(200, {
      'Content-Type': MIME_TYPES[path.extname(filePath)] || 'application/octet-stream',
    });
    res.end(data);
  });
}

const server = http.createServer((req, res) => {
  const { pathname } = new URL(req.url, 'http://localhost');

  if (pathname === '/api/messages') {
    if (req.method !== 'POST') return sendJson(res, 405, { error: 'Method not allowed.' });
    return handleMessage(req, res).catch((err) => {
      console.error('[server] unexpected error:', err);
      if (!res.headersSent) sendJson(res, 500, { error: 'Something went wrong.' });
      else res.end();
    });
  }

  if (req.method === 'GET' || req.method === 'HEAD') return serveStatic(req, res);

  res.writeHead(405);
  res.end();
});

server.listen(PORT, () => {
  console.log(`Listening on http://localhost:${PORT}`);
});
