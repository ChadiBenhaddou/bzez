// Cloudflare Pages Function: POST /api/messages
import { handleMessages, methodNotAllowed } from '../../src/chat.js';

export const onRequestPost = ({ request, env }) => handleMessages(request, env);
export const onRequest = () => methodNotAllowed();
