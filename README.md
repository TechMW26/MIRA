# MIRA — Multi-Intelligent Responsive Assistant

A conversational, research, vision, and media assistant with multi-provider model routing.

## Features

- **Multi-provider model routing** — Mira Lite uses Gemini; Mira and Mira Pro use configured Salad/Ollama-compatible endpoints
- **Automatic internet research** — Deterministic routing plus model-requested live search with citations
- **Chat Interface** — Streaming responses, markdown rendering, syntax-highlighted code
- **Voice Mode** — Hands-free conversation with speech-to-text and text-to-speech
- **Image Analysis** — Analyze uploaded images with prompt-based reasoning
- **Image Generation** — Keeps the current image/video generation pipeline unchanged
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

# Salad/Ollama-compatible chat providers
SALAD_API_URL=
SALAD_API_KEY=
SALAD_API_KEY_HEADER=Salad-Api-Key
OLLAMA_API_URL=http://147.93.102.103:11434/api/chat
MIRA_MODEL=mira-v4
MIRA_PRO_MODEL=mira-pro
MIRA_LOCKED_MODEL=mira-v4
OLLAMA_MAX_TOKENS=12000
OLLAMA_TIMEOUT_MS=300000

# Mira Lite / Gemini
GEMINI_API_KEYS=
GEMINI_PRIMARY_MODEL=gemini-2.5-flash
GEMINI_FALLBACK_MODEL=gemini-flash-latest
GEMINI_LITE_MODEL=gemini-2.5-flash-lite
GEMINI_PRO_MODEL=gemini-2.5-pro
MIRA_LITE_MODEL=gemini-2.5-flash
LITE_MAX_SYSTEM_CHARS=6000

# Image/video generation
POLLINATIONS_API_KEY=
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
- **AI:** Gemini plus Salad/Ollama-compatible chat endpoints

## Internet Search Orchestration

MIRA uses two complementary search triggers:

1. Deterministic routing for explicit searches, current information, prices, schedules, high-stakes facts, and other clearly time-sensitive requests.
2. A model-driven control signal. When MIRA determines that its existing knowledge is insufficient, it returns:

   ```text
   [WEB_SEARCH: concise standalone query]
   ```

The application intercepts this signal—including when it appears in the provider's reasoning stream—runs `/api/search`, and regenerates the answer with live source snippets. Control signals are removed before responses are rendered, cached, or persisted.

Run the routing and control-protocol tests with:

```bash
npm test
```
