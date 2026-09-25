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

## Configuration (`.env`)

| Variable          | Default                     | Purpose                                    |
|-------------------|-----------------------------|--------------------------------------------|
| `OPENAI_API_KEY`  | —                           | Required. Server-side only.                |
| `OPENAI_MODEL`    | `gpt-4o-mini`               | Model to use.                              |
| `OPENAI_BASE_URL` | `https://api.openai.com/v1` | Any compatible endpoint.                   |
| `SYSTEM_PROMPT`   | friendly helper prompt      | Instructions sent with every conversation. |
| `PORT`            | `3000`                      | HTTP port.                                 |

## Structure

- `server.js`: static file server + `/api/messages` streaming proxy
- `public/`: the chat interface (`index.html`, `style.css`, `app.js`)

Conversations are kept in the browser's localStorage; "New chat" clears it.
