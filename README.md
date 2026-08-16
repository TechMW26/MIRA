# MIRA — Multi-Intelligent Responsive Assistant

A conversational, research, vision, and media assistant backed by one dynamically discovered chat model.

## Features

- **Single-model chat** — The server selects the available completion model from the Ollama `/api/tags` registry
- **Automatic internet research** — Deterministic routing plus model-requested live search with citations
- **Chat Interface** — Streaming responses, markdown rendering, syntax-highlighted code
- **Permission-gated Chrome MCP inspection** — Agents can request structured website documentation only after user approval
- **Image Analysis** — Dedicated Gemini vision analysis with ordered API-key fallback; raw images never enter normal chat
- **Image Generation** — Pollinations unified API with server-side authentication and live image-model discovery
- **Project Management** — Organize conversations into projects
- **Authentication** — Email/password registration and login via Firebase
- **Chat History** — Full conversation persistence with Firebase Realtime Database

## Setup

1. Clone the repo and install dependencies:
   ```bash
   npm install
   ```

2. Configure `.env` using `.env.example`.

3. Configure Firebase Realtime Database rules for your environment. Do not use open read/write rules in production.

4. Run the dev server:
   ```bash
   npm run dev
   ```

## Environment Variables

Use these variables locally in `.env` and in Vercel Project Settings -> Environment Variables:

```bash
# Firebase / storage
VITE_FIREBASE_DATABASE_URL=
BLOB_READ_WRITE_TOKEN=

# Chat server; the model is discovered from /api/tags.
OLLAMA_API_URL=http://147.93.102.103:11434/api/chat
OLLAMA_MAX_TOKENS=12000
OLLAMA_CONTEXT_TOKENS=0
OLLAMA_TEMPERATURE=0.2
OLLAMA_TOP_P=0.85
OLLAMA_REPEAT_PENALTY=1.2

# Gemini vision only. GEMINI_API_KEYS accepts comma-separated fallback keys.
GEMINI_API_KEYS=
GEMINI_VISION_MODEL=gemini-2.5-flash

# Optional web search providers
BRAVE_SEARCH_API_KEY=
GOOGLE_SEARCH_API_KEY=
GOOGLE_SEARCH_CX=

# Pollinations image/video generation (server-side key)
POLLINATIONS_API_KEY=
POLLINATIONS_IMAGE_MODEL=
POLLINATIONS_VIDEO_MODEL=wan-pro
```

## Deployment (Vercel)

1. Push to GitHub
2. Import into [Vercel](https://vercel.com)
3. Add all variables from the **Environment Variables** section above into Vercel's Environment Variables settings
4. Deploy

## Tech Stack

- **Frontend:** React 19, Vite, Tailwind CSS
- **Backend:** Vercel Serverless Functions (Edge Runtime)
- **Database:** Firebase Realtime Database
- **Auth:** Custom auth via Firebase RTB (SHA-256 hashed passwords)
- **AI:** One dynamically discovered Ollama-compatible chat model; Gemini is isolated to image analysis

## Internet Search Orchestration

MIRA uses two complementary search triggers:

1. Deterministic routing for explicit searches, current information, prices, schedules, high-stakes facts, and other clearly time-sensitive requests.
2. A model-driven control signal. When MIRA determines that its existing knowledge is insufficient, it returns:

   ```text
   [MIRA_TOOL: {"name":"web.search","arguments":{"query":"concise standalone query"}}]
   ```

The application intercepts this signal—including when it appears in the provider's reasoning stream—runs `/api/search`, and regenerates the answer with live source snippets. Control signals are removed before responses are rendered, cached, or persisted.

For latest/current requests, the search layer applies provider recency filters, merges dated results, ranks them newest-first, and supplies only the freshest dated cohort to MIRA. Grounding instructions require the answer to state the newest evidence date and ignore older superseded claims.

Run the routing and control-protocol tests with:

```bash
npm test
```

## Chrome MCP Website Inspection

When a user explicitly asks MIRA to inspect, crawl, audit, or document a URL, the model can emit:

```text
[MIRA_TOOL: {"name":"browser.inspect","arguments":{"url":"https://example.com","task":"Document the page structure and source"}}]
```

The app removes this control signal from chat, asks the user for action-time permission, and delegates the request to a connected Chrome MCP host. The host can expose either `window.miraMcp.browser.inspectWebsite(request)` or the `mira:mcp-browser-request` / `mira:mcp-browser-response` event contract and set `window.__MIRA_MCP_BROWSER_CONNECTED__ = true`.

Alternatively, configure `MIRA_BROWSER_MCP_URL`, `MIRA_BROWSER_MCP_TOKEN`, and `MIRA_BROWSER_MCP_TOOL` for a server-side Streamable HTTP MCP gateway. MIRA sends a JSON-RPC `tools/call` request only after the user grants permission.

Returned page structure, accessibility information, links, metadata, and source are normalized into an `MCP CHROME WEBSITE DOCUMENTATION` block before the selected model continues. The legacy scraper panel and `/api/scrape` endpoint are intentionally removed.
