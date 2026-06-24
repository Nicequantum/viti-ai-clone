'use client';

import { useCallback, useEffect, useRef, useState, type TextareaHTMLAttributes } from 'react';
import { VoiceInputButton } from './VoiceInputButton';

interface StableTextareaProps extends Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'value' | 'onChange'> {
  value: string;
  onChange: (value: string) => void;
  fieldKey: string;
  showVoice?: boolean;
}

function useStableDraft(value: string, fieldKey: string) {
  const [draft, setDraft] = useState(value);
  const isFocusedRef = useRef(false);
  const lastEmittedRef = useRef(value);
  const selectionRef = useRef<{ start: number; end: number } | null>(null);

  useEffect(() => {
    lastEmittedRef.current = value;
    setDraft(value);
  }, [fieldKey]);

  useEffect(() => {
    if (isFocusedRef.current) return;
    if (value === lastEmittedRef.current) return;
    lastEmittedRef.current = value;
    setDraft(value);
  }, [value]);

  const commit = useCallback((next: string, el?: HTMLTextAreaElement) => {
    if (el && isFocusedRef.current) {
      selectionRef.current = { start: el.selectionStart ?? next.length, end: el.selectionEnd ?? next.length };
    }
    setDraft(next);
    lastEmittedRef.current = next;
  }, []);

  const restoreSelection = useCallback((el: HTMLTextAreaElement | null) => {
    if (!el || !selectionRef.current) return;
    const { start, end } = selectionRef.current;
    requestAnimationFrame(() => {
      try {
        el.setSelectionRange(start, end);
      } catch {
        // ignore unsupported selection states
      }
    });
  }, []);

  return { draft, isFocusedRef, lastEmittedRef, commit, restoreSelection };
}

export function StableTextarea({
  value,
  onChange,
  fieldKey,
  showVoice = true,
  className = '',
  ...props
}: StableTextareaProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const { draft, isFocusedRef, lastEmittedRef, commit, restoreSelection } = useStableDraft(value, fieldKey);

  const handleChange = (next: string) => {
    commit(next, textareaRef.current ?? undefined);
    onChange(next);
    restoreSelection(textareaRef.current);
  };

  return (
    <div className="flex gap-2 items-start w-full min-w-0">
      <textarea
        ref={textareaRef}
        {...props}
        value={draft}
        autoComplete="off"
        spellCheck
        onFocus={(e) => {
          isFocusedRef.current = true;
          props.onFocus?.(e);
        }}
        onBlur={(e) => {
          isFocusedRef.current = false;
          if (draft !== lastEmittedRef.current) {
            lastEmittedRef.current = draft;
            onChange(draft);
          }
          props.onBlur?.(e);
        }}
        onChange={(e) => handleChange(e.target.value)}
        className={`flex-1 min-w-0 w-full touch-manipulation ${className}`}
      />
      {showVoice && (
        <div className="flex flex-col items-end gap-1 shrink-0 mt-1">
          <span className="benz-voice-field-label" title="Hands-free dictation for shop-floor tablets">
            Voice
          </span>
          <VoiceInputButton
            targetRef={textareaRef}
            onTranscript={handleChange}
            className="benz-voice-prominent"
            prominent
          />
        </div>
      )}
    </div>
  );
}