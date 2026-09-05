import { useCallback, useEffect, useRef, useState } from 'react';
import {
  assessVoiceTranscript,
  detectVoiceLanguage,
  getSpeakableIncrement,
  waitForVoiceHealth,
  splitSpeechText,
  synthesizeVoice,
  transcribeVoice,
  updateVoiceInterruptionGate,
} from '../services/voiceConversation';

const VOICE_STATUS_LABELS = {
  idle: 'Voice mode',
  connecting: 'Connecting…',
  listening: 'Listening…',
  transcribing: 'Understanding…',
  thinking: 'Mira is thinking…',
  speaking: 'Mira is speaking…',
  error: 'Voice unavailable',
};

function supportedAudioType() {
  const candidates = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus'];
  return candidates.find((type) => globalThis.MediaRecorder?.isTypeSupported?.(type)) || '';
}

function primeSpeechItem(item, controller) {
  if (!item.audioResult) {
    item.audioResult = synthesizeVoice(item.text, item.language, controller?.signal)
      .then((audio) => ({ audio }))
      .catch((error) => ({ error }));
  }
  return item.audioResult;
}

function primeSpeechWindow(queue, controller, count = 2) {
  queue.slice(0, count).forEach((item) => primeSpeechItem(item, controller));
}

export default function useVoiceConversation({ onTranscript, onInterrupt }) {
  const [active, setActive] = useState(false);
  const [status, setStatus] = useState('idle');
  const [error, setError] = useState('');
  const activeRef = useRef(false);
  const processingRef = useRef(false);
  const resumePendingRef = useRef(false);
  const streamRef = useRef(null);
  const recorderRef = useRef(null);
  const analyserRef = useRef(null);
  const audioContextRef = useRef(null);
  const monitorFrameRef = useRef(0);
  const interruptionFrameRef = useRef(0);
  const interruptionStartedAtRef = useRef(0);
  const interruptionArmedAtRef = useRef(0);
  const playbackStartedAtRef = useRef(0);
  const startCaptureRef = useRef(null);
  const captureStartedAtRef = useRef(0);
  const speechStartedAtRef = useRef(0);
  const silenceStartedAtRef = useRef(0);
  const noiseFloorRef = useRef(0.006);
  const chunksRef = useRef([]);
  const requestAbortRef = useRef(null);
  const speechAbortRef = useRef(null);
  const playbackRef = useRef(null);
  const speechQueueRef = useRef([]);
  const speechWorkerRef = useRef(null);
  const speechGenerationRef = useRef(0);
  const speechStreamRef = useRef({ consumed: '', latest: '', language: 'en', generation: 0 });

  const setVoiceActive = useCallback((value) => {
    activeRef.current = value;
    setActive(value);
  }, []);

  const stopPlayback = useCallback(() => {
    const playback = playbackRef.current;
    playbackRef.current = null;
    playbackStartedAtRef.current = 0;
    if (!playback) return;
    if (playback.source) {
      playback.source.onended = null;
      try { playback.source.stop(); } catch { /* already stopped */ }
      playback.source.disconnect?.();
    }
    if (playback.audio) {
      playback.audio.pause();
      playback.audio.src = '';
    }
    if (playback.url) URL.revokeObjectURL(playback.url);
    playback.finish?.();
  }, []);

  const stopCapture = useCallback(() => {
    cancelAnimationFrame(monitorFrameRef.current);
    monitorFrameRef.current = 0;
    const recorder = recorderRef.current;
    recorderRef.current = null;
    if (recorder?.state && recorder.state !== 'inactive') recorder.stop();
  }, []);

  const stopInterruptionMonitor = useCallback(() => {
    cancelAnimationFrame(interruptionFrameRef.current);
    interruptionFrameRef.current = 0;
    interruptionStartedAtRef.current = 0;
    interruptionArmedAtRef.current = 0;
  }, []);

  const interruptCurrentTurn = useCallback(() => {
    if (!activeRef.current || !processingRef.current) return;
    stopInterruptionMonitor();
    requestAbortRef.current?.abort();
    requestAbortRef.current = null;
    speechAbortRef.current?.abort();
    speechAbortRef.current = null;
    speechGenerationRef.current += 1;
    speechQueueRef.current = [];
    speechStreamRef.current = { consumed: '', latest: '', language: 'en', generation: 0 };
    resumePendingRef.current = false;
    processingRef.current = false;
    stopPlayback();
    setError('');
    setStatus('listening');
    onInterrupt?.();
    queueMicrotask(() => startCaptureRef.current?.());
  }, [onInterrupt, stopInterruptionMonitor, stopPlayback]);

  const startInterruptionMonitor = useCallback(() => {
    stopInterruptionMonitor();
    const analyser = analyserRef.current;
    if (!activeRef.current || !processingRef.current || !analyser) return;
    interruptionArmedAtRef.current = performance.now();
    const samples = new Uint8Array(analyser.frequencyBinCount);
    const monitor = () => {
      if (!activeRef.current || !processingRef.current || analyserRef.current !== analyser) return;
      analyser.getByteTimeDomainData(samples);
      let sum = 0;
      for (const sample of samples) {
        const normalized = (sample - 128) / 128;
        sum += normalized * normalized;
      }
      const rms = Math.sqrt(sum / samples.length);
      const now = performance.now();
      const playbackGrace = playbackStartedAtRef.current
        && now - playbackStartedAtRef.current < 180;
      const gate = updateVoiceInterruptionGate(
        interruptionStartedAtRef.current,
        playbackGrace ? 0 : rms,
        now,
        { threshold: playbackRef.current ? 0.075 : 0.05, holdMs: 120 },
      );
      interruptionStartedAtRef.current = gate.startedAt;
      if (gate.triggered && now - interruptionArmedAtRef.current > 180) {
        interruptCurrentTurn();
        return;
      }
      interruptionFrameRef.current = requestAnimationFrame(monitor);
    };
    interruptionFrameRef.current = requestAnimationFrame(monitor);
  }, [interruptCurrentTurn, stopInterruptionMonitor]);

  const shutdown = useCallback(() => {
    setVoiceActive(false);
    processingRef.current = false;
    resumePendingRef.current = false;
    requestAbortRef.current?.abort();
    requestAbortRef.current = null;
    speechAbortRef.current?.abort();
    speechAbortRef.current = null;
    speechGenerationRef.current += 1;
    speechQueueRef.current = [];
    speechStreamRef.current = { consumed: '', latest: '', language: 'en', generation: 0 };
    stopInterruptionMonitor();
    stopCapture();
    stopPlayback();
    streamRef.current?.getTracks?.().forEach((track) => track.stop());
    streamRef.current = null;
    analyserRef.current = null;
    audioContextRef.current?.close?.().catch(() => {});
    audioContextRef.current = null;
    setStatus('idle');
  }, [setVoiceActive, stopCapture, stopInterruptionMonitor, stopPlayback]);

  const playBlob = useCallback(async (blob) => {
    stopPlayback();
    const context = audioContextRef.current;
    if (context && context.state !== 'closed') {
      try {
        if (context.state === 'suspended') await context.resume();
        const audioBuffer = await context.decodeAudioData(await blob.arrayBuffer());
        await new Promise((resolve, reject) => {
          const source = context.createBufferSource();
          source.buffer = audioBuffer;
          source.connect(context.destination);
          let settled = false;
          const finish = (error) => {
            if (settled) return;
            settled = true;
            if (playbackRef.current?.source === source) playbackRef.current = null;
            source.disconnect?.();
            if (error) reject(error);
            else resolve();
          };
          playbackRef.current = { source, finish };
          source.onended = () => finish();
          try {
            playbackStartedAtRef.current = performance.now();
            source.start(0);
          } catch (error) { finish(error); }
        });
        return;
      } catch {
        // Some browsers reject otherwise valid WAV variants in WebAudio.
        // Fall through to the native media element decoder.
      }
    }

    const url = URL.createObjectURL(blob);
    const audio = new Audio(url);
    await new Promise((resolve, reject) => {
      let settled = false;
      const finish = (errorValue) => {
        if (settled) return;
        settled = true;
        if (playbackRef.current?.audio === audio) playbackRef.current = null;
        URL.revokeObjectURL(url);
        if (errorValue) reject(errorValue);
        else resolve();
      };
      playbackRef.current = { audio, url, finish };
      audio.onended = () => finish();
      audio.onerror = () => finish(new Error('Audio playback failed.'));
      playbackStartedAtRef.current = performance.now();
      audio.play().catch(finish);
    });
  }, [stopPlayback]);

  const runSpeechQueue = useCallback((generation = speechGenerationRef.current) => {
    if (generation !== speechGenerationRef.current) return Promise.resolve();
    if (speechWorkerRef.current?.generation === generation) return speechWorkerRef.current.promise;
    const worker = (async () => {
      const controller = speechAbortRef.current;
      while (
        activeRef.current
        && generation === speechGenerationRef.current
        && !controller?.signal.aborted
        && speechQueueRef.current.length
      ) {
        const item = speechQueueRef.current.shift();
        if (item.generation !== generation) continue;
        setStatus('speaking');
        const resultPromise = primeSpeechItem(item, controller);
        primeSpeechWindow(speechQueueRef.current, controller);
        const result = await resultPromise;
        if (generation !== speechGenerationRef.current || controller?.signal.aborted) return;
        if (result.error) throw result.error;
        await playBlob(result.audio);
      }
    })();
    const workerRecord = { generation, promise: worker };
    speechWorkerRef.current = workerRecord;
    worker.catch((voiceError) => {
      if (
        voiceError?.name === 'AbortError'
        || !activeRef.current
        || generation !== speechGenerationRef.current
      ) return;
      setError(voiceError?.message || 'MIRA could not play the voice response.');
      setStatus('error');
    }).finally(() => {
      if (speechWorkerRef.current === workerRecord) speechWorkerRef.current = null;
      if (
        activeRef.current
        && generation === speechGenerationRef.current
        && speechQueueRef.current.some((item) => item.generation === generation)
      ) runSpeechQueue(generation);
    });
    return worker;
  }, [playBlob]);

  const beginSpeech = useCallback((hintedLanguage = '') => {
    speechAbortRef.current?.abort();
    stopPlayback();
    const generation = speechGenerationRef.current + 1;
    speechGenerationRef.current = generation;
    speechQueueRef.current = [];
    speechAbortRef.current = new AbortController();
    speechStreamRef.current = {
      consumed: '',
      latest: '',
      language: detectVoiceLanguage('', hintedLanguage),
      generation,
    };
  }, [stopPlayback]);

  const queueSpeech = useCallback((text, hintedLanguage = '', final = false) => {
    if (!activeRef.current) return;
    const stream = speechStreamRef.current;
    if (!stream.generation || stream.generation !== speechGenerationRef.current) return;
    stream.language = detectVoiceLanguage(text, hintedLanguage || stream.language);
    stream.latest = text;
    const increment = getSpeakableIncrement(stream.consumed, text, final);
    if (!increment.text) return;
    stream.consumed = increment.consumed;
    for (const chunk of splitSpeechText(increment.text, 148)) {
      speechQueueRef.current.push({
        text: chunk,
        language: stream.language,
        generation: stream.generation,
      });
    }
    primeSpeechWindow(speechQueueRef.current, speechAbortRef.current);
    runSpeechQueue(stream.generation);
  }, [runSpeechQueue]);

  const finishSpeech = useCallback(async (text, hintedLanguage = '') => {
    const generation = speechStreamRef.current.generation;
    queueSpeech(text, hintedLanguage, true);
    while (
      activeRef.current
      && generation === speechGenerationRef.current
      && (speechWorkerRef.current?.generation === generation
        || speechQueueRef.current.some((item) => item.generation === generation))
    ) {
      if (speechWorkerRef.current?.generation !== generation) runSpeechQueue(generation);
      await speechWorkerRef.current?.promise?.catch(() => {});
    }
  }, [queueSpeech, runSpeechQueue]);

  const speak = useCallback(async (text, hintedLanguage = '') => {
    if (!activeRef.current) return;
    beginSpeech(hintedLanguage);
    await finishSpeech(text, hintedLanguage);
  }, [beginSpeech, finishSpeech]);

  const startCapture = useCallback(() => {
    if (
      !activeRef.current
      || processingRef.current
      || !streamRef.current
      || (recorderRef.current && recorderRef.current.state !== 'inactive')
    ) return;
    resumePendingRef.current = false;
    const recorder = new MediaRecorder(streamRef.current, supportedAudioType() ? { mimeType: supportedAudioType() } : undefined);
    chunksRef.current = [];
    recorder.ondataavailable = (event) => {
      if (event.data?.size) chunksRef.current.push(event.data);
    };
    recorderRef.current = recorder;
    captureStartedAtRef.current = performance.now();
    speechStartedAtRef.current = 0;
    silenceStartedAtRef.current = 0;
    noiseFloorRef.current = Math.min(Math.max(noiseFloorRef.current, 0.004), 0.015);
    recorder.start(160);
    setStatus('listening');

    const samples = new Uint8Array(analyserRef.current.frequencyBinCount);
    const monitor = () => {
      if (recorderRef.current !== recorder || recorder.state === 'inactive') return;
      analyserRef.current.getByteTimeDomainData(samples);
      let sum = 0;
      for (const sample of samples) {
        const normalized = (sample - 128) / 128;
        sum += normalized * normalized;
      }
      const rms = Math.sqrt(sum / samples.length);
      const now = performance.now();
      const floor = noiseFloorRef.current;
      const speechThreshold = Math.min(0.04, Math.max(0.016, floor * 2.6 + 0.003));
      if (!speechStartedAtRef.current && rms < speechThreshold) {
        noiseFloorRef.current = (floor * 0.92) + (Math.min(rms, 0.025) * 0.08);
      }
      if (rms > speechThreshold) {
        if (!speechStartedAtRef.current) speechStartedAtRef.current = now;
        silenceStartedAtRef.current = 0;
      } else if (speechStartedAtRef.current) {
        if (!silenceStartedAtRef.current) silenceStartedAtRef.current = now;
        const enoughSpeech = now - speechStartedAtRef.current > 220;
        if (enoughSpeech && now - silenceStartedAtRef.current > 650) {
          recorder.stop();
          return;
        }
      }
      if (now - captureStartedAtRef.current > 25_000) recorder.stop();
      else monitorFrameRef.current = requestAnimationFrame(monitor);
    };
    monitorFrameRef.current = requestAnimationFrame(monitor);

    recorder.onstop = async () => {
      cancelAnimationFrame(monitorFrameRef.current);
      if (recorderRef.current === recorder) recorderRef.current = null;
      const hadSpeech = Boolean(speechStartedAtRef.current);
      const blob = new Blob(chunksRef.current, { type: recorder.mimeType || 'audio/webm' });
      if (!activeRef.current) return;
      if (!hadSpeech || blob.size < 400) {
        startCapture();
        return;
      }
      processingRef.current = true;
      setStatus('transcribing');
      const controller = new AbortController();
      requestAbortRef.current = controller;
      try {
        const transcript = await transcribeVoice(blob, controller.signal, {
          language: '',
        });
        const assessedTranscript = assessVoiceTranscript(transcript?.text);
        if (!assessedTranscript.usable) {
          setError('');
          setStatus('listening');
          resumePendingRef.current = true;
          return;
        }
        const text = assessedTranscript.text;
        setStatus('thinking');
        startInterruptionMonitor();
        await onTranscript(text, { language: transcript.language || detectVoiceLanguage(text) });
        resumePendingRef.current = true;
      } catch (voiceError) {
        if (voiceError?.name !== 'AbortError') {
          setError(voiceError?.message || 'Voice mode failed.');
          setStatus('error');
        }
      } finally {
        stopInterruptionMonitor();
        processingRef.current = false;
        if (requestAbortRef.current === controller) requestAbortRef.current = null;
        if (resumePendingRef.current && activeRef.current) startCapture();
      }
    };
  }, [onTranscript, startInterruptionMonitor, stopInterruptionMonitor]);
  startCaptureRef.current = startCapture;

  const start = useCallback(async () => {
    if (!navigator.mediaDevices?.getUserMedia || !globalThis.MediaRecorder) {
      setError('Voice mode is not supported by this browser.');
      setStatus('error');
      return;
    }
    setError('');
    setStatus('connecting');
    try {
      const AudioContextClass = globalThis.AudioContext || globalThis.webkitAudioContext;
      if (!AudioContextClass) throw new Error('Live microphone analysis is not supported here.');
      const context = new AudioContextClass();
      audioContextRef.current = context;
      await context.resume();
      const unlockSource = context.createBufferSource();
      unlockSource.buffer = context.createBuffer(1, 1, context.sampleRate);
      unlockSource.connect(context.destination);
      unlockSource.start(0);

      const healthController = new AbortController();
      const healthTimeout = setTimeout(() => healthController.abort(), 15_000);
      const healthPromise = waitForVoiceHealth(healthController.signal)
        .finally(() => clearTimeout(healthTimeout));
      const streamPromise = navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 },
      });
      let stream;
      try {
        [stream] = await Promise.all([
          streamPromise,
          healthPromise.then((health) => {
            if (!health.ready) {
              throw new Error(health.error || 'Voice engines are still warming up. Try again shortly.');
            }
            return health;
          }),
        ]);
      } catch (voiceError) {
        streamPromise.then((pendingStream) => {
          pendingStream?.getTracks?.().forEach((track) => track.stop());
        }).catch(() => {});
        throw voiceError;
      }
      const source = context.createMediaStreamSource(stream);
      const analyser = context.createAnalyser();
      analyser.fftSize = 1024;
      analyser.smoothingTimeConstant = 0.25;
      source.connect(analyser);
      streamRef.current = stream;
      analyserRef.current = analyser;
      setVoiceActive(true);
      startCapture();
    } catch (voiceError) {
      shutdown();
      setError(voiceError?.name === 'NotAllowedError'
        ? 'Microphone access was denied. Allow it in browser or system settings.'
        : voiceError?.message || 'Voice mode could not start.');
      setStatus('error');
    }
  }, [setVoiceActive, shutdown, startCapture]);

  const toggle = useCallback(() => {
    if (activeRef.current) shutdown();
    else start();
  }, [shutdown, start]);

  const resumeListening = useCallback(() => {
    if (!activeRef.current) return;
    setError('');
    resumePendingRef.current = true;
    if (!processingRef.current) startCapture();
  }, [startCapture]);

  useEffect(() => shutdown, [shutdown]);

  return {
    active,
    status,
    statusLabel: error || VOICE_STATUS_LABELS[status] || 'Voice mode',
    toggle,
    start,
    shutdown,
    speak,
    beginSpeech,
    queueSpeech,
    finishSpeech,
    resumeListening,
  };
}
