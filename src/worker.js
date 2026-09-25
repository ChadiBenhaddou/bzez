// Cloudflare Worker entry: /api/messages goes to the chat handler,
// everything else is served from the static files in public/.
import { handleMessages, methodNotAllowed } from './chat.js';

export default {
  async fetch(request, env) {
    const { pathname } = new URL(request.url);
    if (pathname === '/api/messages') {
      if (request.method !== 'POST') return methodNotAllowed();
      return handleMessages(request, env);
    }
    return env.ASSETS.fetch(request);
  },
};
