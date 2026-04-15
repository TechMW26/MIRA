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

2. Copy `.env.example` to `.env` and fill in your Firebase config:
   ```bash
   cp .env.example .env
   ```

3. In [Firebase Console](https://console.firebase.google.com/):
   - Go to **Project Settings → General → Your apps → Web app**
   - Copy the config values into `.env`
   - Enable **Email/Password** auth under **Authentication → Sign-in method**
   - Set RTDB rules to allow authenticated reads/writes

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
- **Auth:** Firebase Authentication
- **AI:** Google Gemini API, OpenAI API
