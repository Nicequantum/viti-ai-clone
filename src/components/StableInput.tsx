'use client';

import { useCallback, useEffect, useRef, useState, type InputHTMLAttributes } from 'react';
import { VoiceInputButton } from './VoiceInputButton';

interface StableInputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange'> {
  value: string;
  onChange: (value: string) => void;
  fieldKey: string;
  showVoice?: boolean;
}

export function StableInput({
  value,
  onChange,
  fieldKey,
  showVoice = false,
  className = '',
  ...props
}: StableInputProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [draft, setDraft] = useState(value);
  const isFocusedRef = useRef(false);
  const lastEmittedRef = useRef(value);

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

  const commit = useCallback(
    (next: string) => {
      setDraft(next);
      lastEmittedRef.current = next;
      onChange(next);
    },
    [onChange]
  );

  return (
    <div className={showVoice ? 'flex gap-2 items-center w-full min-w-0' : 'w-full min-w-0'}>
      <input
        ref={inputRef}
        {...props}
        value={draft}
        autoComplete="off"
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
        onChange={(e) => commit(e.target.value)}
        className={`${showVoice ? 'flex-1 min-w-0 w-full ' : 'w-full '}touch-manipulation ${className}`}
      />
      {showVoice && (
        <div className="flex flex-col items-end gap-1 shrink-0">
          <span className="benz-voice-field-label">Voice</span>
          <VoiceInputButton targetRef={inputRef} onTranscript={commit} className="benz-voice-prominent" prominent />
        </div>
      )}
    </div>
  );
}