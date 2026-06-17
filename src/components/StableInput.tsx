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

  useEffect(() => {
    if (!isFocusedRef.current) setDraft(value);
  }, [value, fieldKey]);

  const commit = useCallback(
    (next: string) => {
      setDraft(next);
      onChange(next);
    },
    [onChange]
  );

  return (
    <div className={showVoice ? 'flex gap-2 items-center w-full' : 'w-full'}>
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
          if (draft !== value) onChange(draft);
          props.onBlur?.(e);
        }}
        onChange={(e) => commit(e.target.value)}
        className={`${showVoice ? 'flex-1 ' : ''}touch-manipulation ${className}`}
      />
      {showVoice && <VoiceInputButton targetRef={inputRef} onTranscript={commit} />}
    </div>
  );
}