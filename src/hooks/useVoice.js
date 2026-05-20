import { useState, useCallback, useRef, useEffect } from 'react';
import { createSpeechUtterance, pickPreferredVoice, formatVoiceLabel, findVoiceById, getPreferredVoiceId, setPreferredVoiceId } from '../utils/tts';

export default function useVoice(onResult) {
  const [isListening, setIsListening] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [voices, setVoices] = useState([]);
  const recognitionRef = useRef(null);
  const synthRef = useRef(window.speechSynthesis);
  const voiceRef = useRef(null);

  useEffect(() => {
    if (typeof window === 'undefined' || !window.speechSynthesis) return undefined;

    const refreshVoices = () => {
      const nextVoices = window.speechSynthesis.getVoices();
      setVoices(nextVoices);
      const best = pickPreferredVoice(nextVoices);
      if (best) voiceRef.current = best;
    };

    refreshVoices();
    window.speechSynthesis.addEventListener?.('voiceschanged', refreshVoices);
    return () => window.speechSynthesis.removeEventListener?.('voiceschanged', refreshVoices);
  }, []);

  useEffect(() => {
    const SpeechRecognition =
      window.SpeechRecognition || window.webkitSpeechRecognition;

    if (!SpeechRecognition) return;

    const recognition = new SpeechRecognition();
    recognition.continuous = false;
    recognition.interimResults = false;
    recognition.lang = 'en-US';

    recognition.onresult = (event) => {
      const transcript = event.results[0][0].transcript;
      onResult?.(transcript);
      setIsListening(false);
    };

    recognition.onerror = () => {
      setIsListening(false);
    };

    recognition.onend = () => {
      setIsListening(false);
    };

    recognitionRef.current = recognition;
  }, [onResult]);

  const startListening = useCallback(() => {
    if (recognitionRef.current && !isListening) {
      recognitionRef.current.start();
      setIsListening(true);
    }
  }, [isListening]);

  const stopListening = useCallback(() => {
    if (recognitionRef.current && isListening) {
      recognitionRef.current.stop();
      setIsListening(false);
    }
  }, [isListening]);

  const speak = useCallback((text) => {
    if (!synthRef.current) return;
    synthRef.current.cancel();

    const currentVoice = findVoiceById(synthRef.current.getVoices(), getPreferredVoiceId()) || voiceRef.current || pickPreferredVoice(synthRef.current.getVoices());
    const utterance = createSpeechUtterance(text, currentVoice);
    utterance.onstart = () => setIsSpeaking(true);
    utterance.onend = () => setIsSpeaking(false);
    utterance.onerror = () => setIsSpeaking(false);

    synthRef.current.speak(utterance);
  }, []);

  const stopSpeaking = useCallback(() => {
    synthRef.current?.cancel();
    setIsSpeaking(false);
  }, []);

  const selectedVoiceId = getPreferredVoiceId();

  const setSelectedVoiceId = useCallback((voiceId) => {
    setPreferredVoiceId(voiceId);
    if (!synthRef.current) return;
    const nextVoice = findVoiceById(synthRef.current.getVoices(), voiceId) || pickPreferredVoice(synthRef.current.getVoices());
    if (nextVoice) voiceRef.current = nextVoice;
  }, []);

  const isSupported =
    typeof window !== 'undefined' &&
    (window.SpeechRecognition || window.webkitSpeechRecognition);

  return {
    isListening,
    isSpeaking,
    isSupported,
    voices,
    selectedVoiceId,
    selectedVoiceLabel: formatVoiceLabel(findVoiceById(voices, selectedVoiceId) || pickPreferredVoice(voices)),
    startListening,
    stopListening,
    speak,
    stopSpeaking,
    setSelectedVoiceId,
  };
}
