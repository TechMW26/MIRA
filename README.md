# MIRA — Multi-Intelligent Responsive Assistant

A conversational and vision analysis platform powered by Ollama.

## Features

- **Single Ollama Text Provider** — Uses your configured Ollama endpoint for all text chat/analysis
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

2. The app is pre-configured to use the Firebase RTB directly. No Firebase console setup needed.

3. Set your RTDB rules to allow open read/write:
   ```json
   {
     "rules": {
       ".read": true,
       ".write": true
     }
   }
   ```

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

# Ollama (text + vision chat)
OLLAMA_API_URL=http://147.93.102.103:11434/api/generate
OLLAMA_TEXT_MODEL=huihui_ai/deepseek-r1-abliterated:14b
OLLAMA_VISION_MODEL=llama3.2-vision
OLLAMA_MAX_TOKENS=2048
OLLAMA_TIMEOUT_MS=90000

# Keep existing image/video generation pipeline
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
- **AI:** Ollama (`/api/chat` proxying to your `OLLAMA_API_URL`)
