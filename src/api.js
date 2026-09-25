// OpenAI-compatible API under /v1 for coding tools (OpenCode, Continue, Cline, ...).
// Clients authenticate with your own keys (ACCESS_KEYS secret, comma-separated);
// the upstream OPENAI_API_KEY never leaves the server.
//
//   GET  /v1/models
//   POST /v1/chat/completions   (streaming and tool calls passed through as-is)

import { identityPrompt, scrubText, scrubCompletion, newCompletionId } from './identity.js';

const PUBLIC_MODEL_ID = 'default';

function json(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
}

function apiError(status, message, type = 'invalid_request_error') {
  return json(status, { error: { message, type } });
}

async function sha256(text) {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)));
}

// Compare hashes so the check takes the same time whatever the key looks like.
async function isAuthorized(request, env) {
  const header = request.headers.get('Authorization') || '';
  const given = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
  const keys = (env.ACCESS_KEYS || '').split(',').map((k) => k.trim()).filter(Boolean);
  if (!given || keys.length === 0) return false;

  const givenHash = await sha256(given);
  let ok = false;
  for (const key of keys) {
    const keyHash = await sha256(key);
    let diff = 0;
    for (let i = 0; i < keyHash.length; i++) diff |= keyHash[i] ^ givenHash[i];
    if (diff === 0) ok = true;
  }
  return ok;
}

function upstreamModel(env) {
  return env.CODE_MODEL || env.OPENAI_MODEL || 'gpt-4o-mini';
}

async function chatCompletions(request, env) {
  let body;
  try {
    body = await request.json();
  } catch {
    return apiError(400, 'Request body must be JSON.');
  }
  if (!body || !Array.isArray(body.messages)) return apiError(400, '"messages" is required.');

  // Whatever model name the client sends, use the one configured on the server,
  // and put the identity instructions ahead of the tool's own system prompt.
  body.model = upstreamModel(env);
  body.messages = [{ role: 'system', content: identityPrompt(env) }, ...body.messages];

  const baseUrl = (env.OPENAI_BASE_URL || 'https://api.openai.com/v1').replace(/\/+$/, '');
  let upstream;
  try {
    upstream = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${env.OPENAI_API_KEY}`,
      },
      body: JSON.stringify(body),
    });
  } catch (err) {
    console.error('[v1] upstream request failed:', err.message);
    return apiError(502, 'Service temporarily unavailable.', 'server_error');
  }

  if (!upstream.ok) {
    const detail = await upstream.text().catch(() => '');
    console.error(`[v1] upstream ${upstream.status}: ${detail.slice(0, 500)}`);
    // Pass client errors (bad request, context too long) through so the tool can react;
    // hide everything else, especially upstream auth/billing problems.
    if (upstream.status === 400 || upstream.status === 413 || upstream.status === 422) {
      let error = {};
      try {
        error = JSON.parse(detail).error || {};
      } catch {
        // not JSON — fall back to a generic message
      }
      return json(upstream.status, {
        error: {
          message: scrubText(error.message || 'Invalid request.'),
          type: 'invalid_request_error',
          code: error.code || null,
        },
      });
    }
    if (upstream.status === 429) return apiError(429, 'Rate limited. Try again shortly.', 'rate_limit_error');
    return apiError(502, 'Service temporarily unavailable.', 'server_error');
  }

  const id = newCompletionId();
  const contentType = upstream.headers.get('Content-Type') || '';

  if (!contentType.includes('text/event-stream')) {
    const data = await upstream.json().catch(() => null);
    if (!data) return apiError(502, 'Service temporarily unavailable.', 'server_error');
    return json(200, scrubCompletion(data, id));
  }

  // Rewrite each streamed chunk; content and tool calls are left untouched.
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  let buffer = '';
  const rewriteLine = (line) => {
    if (!line.startsWith('data:')) return line;
    const data = line.slice(5).trim();
    if (!data || data === '[DONE]') return line;
    try {
      return 'data: ' + JSON.stringify(scrubCompletion(JSON.parse(data), id));
    } catch {
      return line;
    }
  };
  const scrub = new TransformStream({
    transform(chunk, controller) {
      buffer += decoder.decode(chunk, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop();
      if (lines.length) controller.enqueue(encoder.encode(lines.map(rewriteLine).join('\n') + '\n'));
    },
    flush(controller) {
      buffer += decoder.decode();
      if (buffer) controller.enqueue(encoder.encode(rewriteLine(buffer)));
    },
  });

  return new Response(upstream.body.pipeThrough(scrub), {
    status: 200,
    headers: { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache' },
  });
}

export async function handleApi(request, env) {
  const { pathname } = new URL(request.url);

  if (!(await isAuthorized(request, env))) {
    return apiError(401, 'Invalid API key.', 'authentication_error');
  }
  if (!env.OPENAI_API_KEY) return apiError(503, 'Service is not configured.', 'server_error');

  if (pathname === '/v1/models' && request.method === 'GET') {
    return json(200, {
      object: 'list',
      data: [{ id: PUBLIC_MODEL_ID, object: 'model', created: 0, owned_by: 'owner' }],
    });
  }
  if (pathname === '/v1/chat/completions') {
    if (request.method !== 'POST') return apiError(405, 'Method not allowed.');
    return chatCompletions(request, env);
  }
  return apiError(404, 'Not found.');
}
