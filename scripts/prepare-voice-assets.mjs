import { mkdir, cp } from 'node:fs/promises';
await mkdir(new URL('../public/voice-vision/wasm/', import.meta.url), { recursive: true });
await cp(new URL('../node_modules/@mediapipe/tasks-vision/wasm/', import.meta.url), new URL('../public/voice-vision/wasm/', import.meta.url), { recursive: true });
