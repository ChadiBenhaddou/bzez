# bzez

A minimal chat web app. The browser talks only to this server; the server forwards
the conversation to the OpenAI API and streams the reply back as plain text.

The public side (HTML, CSS, JS, URLs, response headers) contains no references to
the upstream provider or model: the page is just "Chat", the endpoint is
`POST /api/messages`, and message roles are `user` / `reply`. The API key, model
name and system prompt stay on the server.

## Run

Requires Node.js 20.12+ (no npm dependencies).

```bash
cp .env.example .env   # then put your key in OPENAI_API_KEY
npm start              # http://localhost:3000
```

## Deploy on Cloudflare

Either product works; the chat handler lives in `src/chat.js`.

**Workers** (Workers & Pages → Create → import the repo): uses `wrangler.jsonc`
(`src/worker.js` + static files from `public/`). The `name` in `wrangler.jsonc`
must match the Worker's name in the dashboard.

**Pages**: framework preset None, empty build command, output directory `public`.
`functions/api/messages.js` provides the endpoint.

For both: Settings → Variables and Secrets → add `OPENAI_API_KEY` as type
**Secret** (never in a config file), then redeploy.

## API for coding tools (OpenCode etc.)

`/v1` is an OpenAI-compatible API protected by your own keys, so tools like
OpenCode can use it. Your OpenAI key stays in Cloudflare.

1. Create a key: `node scripts/new-key.js` (prints e.g. `bz-...`).
2. In Cloudflare → Settings → Variables and Secrets add **Secret** `ACCESS_KEYS`
   with that key (several keys: comma-separated; delete one to revoke it).
   Optional: `CODE_MODEL` to use a stronger model for the API than the chat.
3. Redeploy.

OpenCode (`~/.config/opencode/opencode.json` or `opencode.json` in a project):

```json
{
  "$schema": "https://opencode.ai/config.json",
  "provider": {
    "bzez": {
      "npm": "@ai-sdk/openai-compatible",
      "name": "bzez",
      "options": {
        "baseURL": "https://YOUR-SITE/v1",
        "apiKey": "{env:BZEZ_API_KEY}"
      },
      "models": { "default": { "name": "Default" } }
    }
  }
}
```

Then `export BZEZ_API_KEY=bz-...`, run `opencode`, and pick `bzez/default` with `/models`.

## Configuration (`.env`)

| Variable          | Default                     | Purpose                                    |
|-------------------|-----------------------------|--------------------------------------------|
| `OPENAI_API_KEY`  | —                           | Required. Server-side only.                |
| `OPENAI_MODEL`    | `gpt-4o-mini`               | Model to use.                              |
| `OPENAI_BASE_URL` | `https://api.openai.com/v1` | Any compatible endpoint.                   |
| `SYSTEM_PROMPT`   | friendly helper prompt      | Instructions sent with every conversation. |
| `PORT`            | `3000`                      | HTTP port.                                 |

## Structure

- `server.js`: local Node server (static files + `/api/messages` streaming proxy)
- `src/chat.js`: the same handler for Cloudflare, used by `src/worker.js`
  (Workers) and `functions/api/messages.js` (Pages)
- `src/api.js`: key-protected OpenAI-compatible `/v1` API (Worker and Pages)
- `scripts/new-key.js`: generates an access key
- `public/`: the chat interface (`index.html`, `style.css`, `app.js`)

Conversations are kept in the browser's localStorage; "New chat" clears it.
