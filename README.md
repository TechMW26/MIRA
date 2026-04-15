# MIRA — Multi-Intelligent Responsive Assistant

A ChatGPT-like AI platform powered by multiple AI agents (Gemini, OpenAI). Features include real-time chat, voice mode, code generation, document creation, and image generation.

## Features

- **Multi-Model AI** — Gemini 2.5 Pro, Gemini 2.0 Flash, GPT-4o with automatic fallback
- **Chat Interface** — Streaming responses, markdown rendering, syntax-highlighted code
- **Voice Mode** — Hands-free conversation with speech-to-text and text-to-speech
- **Image Generation** — Create images via DALL-E 3
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

## Deployment (Vercel)

1. Push to GitHub
2. Import into [Vercel](https://vercel.com)
3. Add all `.env` variables in Vercel's Environment Variables settings
4. Deploy

## Tech Stack

- **Frontend:** React 19, Vite, Tailwind CSS
- **Backend:** Vercel Serverless Functions (Edge Runtime)
- **Database:** Firebase Realtime Database
- **Auth:** Custom auth via Firebase RTB (SHA-256 hashed passwords)
- **AI:** Google Gemini API, OpenAI API
