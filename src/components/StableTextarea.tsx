'use client';

import { useCallback, useEffect, useRef, useState, type TextareaHTMLAttributes } from 'react';
import { VoiceInputButton } from './VoiceInputButton';

interface StableTextareaProps extends Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'value' | 'onChange'> {
  value: string;
  onChange: (value: string) => void;
  fieldKey: string;
  showVoice?: boolean;
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
    <div className="flex gap-2 items-start w-full">
      <textarea
        ref={textareaRef}
        {...props}
        value={draft}
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
        className={`flex-1 ${className}`}
      />
      {showVoice && <VoiceInputButton targetRef={textareaRef} onTranscript={commit} className="mt-2 shrink-0" />}
    </div>
  );
}