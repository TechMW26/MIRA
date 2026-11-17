# Local face presence model

`blaze_face_short_range.tflite` is Google's MediaPipe BlazeFace short-range detector, obtained from the official model distribution:
https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_short_range/float16/latest/blaze_face_short_range.tflite

Used only for on-device presence detection, not identification. No camera frames leave the browser. MediaPipe is Apache-2.0 licensed. Runtime WASM files are copied from the pinned `@mediapipe/tasks-vision` package by `scripts/prepare-voice-assets.mjs` before development and builds.
