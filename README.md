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
- `public/`: the chat interface (`index.html`, `style.css`, `app.js`)

Conversations are kept in the browser's localStorage; "New chat" clears it.
