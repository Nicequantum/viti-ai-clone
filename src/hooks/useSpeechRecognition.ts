'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

interface SpeechRecognitionResultLike {
  isFinal: boolean;
  0: { transcript: string };
}

interface SpeechRecognitionEventLike {
  resultIndex: number;
  results: SpeechRecognitionResultLike[];
}

interface SpeechRecognitionInstance extends EventTarget {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start: () => void;
  stop: () => void;
  abort: () => void;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
}

type SpeechRecognitionCtor = new () => SpeechRecognitionInstance;

function getSpeechRecognition(): SpeechRecognitionCtor | null {
  const w = window as Window & {
    SpeechRecognition?: SpeechRecognitionCtor;
    webkitSpeechRecognition?: SpeechRecognitionCtor;
  };
  return w.SpeechRecognition || w.webkitSpeechRecognition || null;
}

export function useSpeechRecognition() {
  const recognitionRef = useRef<SpeechRecognitionInstance | null>(null);
  const [isListening, setIsListening] = useState(false);
  const [isSupported] = useState(() => typeof window !== 'undefined' && !!getSpeechRecognition());

  useEffect(() => {
    return () => {
      recognitionRef.current?.abort();
    };
  }, []);

  const startListening = useCallback(
    (textarea: HTMLTextAreaElement | HTMLInputElement, onTranscript: (value: string) => void): boolean => {
      const Ctor = getSpeechRecognition();
      if (!Ctor) return false;

      recognitionRef.current?.abort();

      const recognition = new Ctor();
      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.lang = 'en-US';

      const selectionStart = textarea.selectionStart ?? textarea.value.length;
      const selectionEnd = textarea.selectionEnd ?? textarea.value.length;
      const prefix = textarea.value.slice(0, selectionStart);
      const suffix = textarea.value.slice(selectionEnd);
      let committed = prefix;

      recognition.onresult = (event) => {
        let interim = '';
        for (let i = event.resultIndex; i < event.results.length; i++) {
          const result = event.results[i];
          const text = result[0]?.transcript ?? '';
          if (result.isFinal) committed += text;
          else interim += text;
        }
        const next = committed + interim;
        onTranscript(next + suffix);
        const cursor = committed.length + interim.length;
        requestAnimationFrame(() => {
          textarea.setSelectionRange(cursor, cursor);
        });
      };

      recognition.onerror = () => setIsListening(false);
      recognition.onend = () => setIsListening(false);

      recognitionRef.current = recognition;
      recognition.start();
      setIsListening(true);
      return true;
    },
    []
  );

  const stopListening = useCallback(() => {
    recognitionRef.current?.stop();
    setIsListening(false);
  }, []);

  const toggleListening = useCallback(
    (textarea: HTMLTextAreaElement | HTMLInputElement, onTranscript: (value: string) => void) => {
      if (isListening) stopListening();
      else startListening(textarea, onTranscript);
    },
    [isListening, startListening, stopListening]
  );

  return { isListening, isSupported, toggleListening, stopListening };
}