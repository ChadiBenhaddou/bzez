// POST /api/messages handler shared by the Cloudflare Worker (src/worker.js)
// and the Cloudflare Pages Function (functions/api/messages.js).
// Same contract as server.js. Set OPENAI_API_KEY as a Secret (and optionally
// OPENAI_MODEL, OPENAI_BASE_URL, SYSTEM_PROMPT) in the Cloudflare dashboard.

const MAX_MESSAGES = 40;
const MAX_MESSAGE_CHARS = 8000;
const DEFAULT_PROMPT =
  'You are a helpful, friendly conversational partner. Answer clearly and concisely.';

function json(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
}

// The browser uses neutral roles ("user" / "reply"); map them to the upstream format here.
function toUpstreamMessages(messages, systemPrompt) {
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
  return [{ role: 'system', content: systemPrompt }, ...mapped];
}

export async function handleMessages(request, env) {
  let payload;
  try {
    payload = await request.json();
  } catch {
    return json(400, { error: 'Invalid request.' });
  }

  const messages = toUpstreamMessages(payload && payload.messages, env.SYSTEM_PROMPT || DEFAULT_PROMPT);
  if (!messages) return json(400, { error: 'Invalid conversation.' });
  if (!env.OPENAI_API_KEY) return json(503, { error: 'Service is not configured.' });

  const baseUrl = (env.OPENAI_BASE_URL || 'https://api.openai.com/v1').replace(/\/+$/, '');
  let upstream;
  try {
    upstream = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${env.OPENAI_API_KEY}`,
      },
      body: JSON.stringify({ model: env.OPENAI_MODEL || 'gpt-4o-mini', messages, stream: true }),
    });
  } catch (err) {
    console.error('[upstream] request failed:', err.message);
    return json(502, { error: 'Service temporarily unavailable.' });
  }

  if (!upstream.ok || !upstream.body) {
    const detail = await upstream.text().catch(() => '');
    console.error(`[upstream] ${upstream.status}: ${detail.slice(0, 500)}`);
    return json(502, { error: 'Service temporarily unavailable.' });
  }

  // Stream plain text back to the browser — no provider metadata is forwarded.
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  let buffer = '';
  const toText = new TransformStream({
    transform(chunk, controller) {
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
          if (delta) controller.enqueue(encoder.encode(delta));
        } catch {
          // ignore malformed keep-alive lines
        }
      }
    },
  });

  return new Response(upstream.body.pipeThrough(toText), {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
    },
  });
}

export function methodNotAllowed() {
  return json(405, { error: 'Method not allowed.' });
}
