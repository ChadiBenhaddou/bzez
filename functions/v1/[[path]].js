// Cloudflare Pages Function: /v1/* (key-protected API for coding tools)
import { handleApi } from '../../src/api.js';

export const onRequest = ({ request, env }) => handleApi(request, env);
