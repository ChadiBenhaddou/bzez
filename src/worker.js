// Cloudflare Worker entry: /api/messages goes to the chat handler, /v1/* is the
// key-protected API for coding tools, everything else is served from public/.
import { handleMessages, methodNotAllowed } from './chat.js';
import { handleApi } from './api.js';

export default {
  async fetch(request, env) {
    const { pathname } = new URL(request.url);
    if (pathname === '/api/messages') {
      if (request.method !== 'POST') return methodNotAllowed();
      return handleMessages(request, env);
    }
    if (pathname === '/v1' || pathname.startsWith('/v1/')) return handleApi(request, env);
    return env.ASSETS.fetch(request);
  },
};
