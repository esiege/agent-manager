import { CloseButton, TextInput, type TextInputProps } from '@mantine/core';
import { useDebouncedCallback } from '@mantine/hooks';
import { useState } from 'react';

interface DebouncedTextInputProps extends Omit<TextInputProps, 'value' | 'onChange' | 'rightSection'> {
  /** The committed value, for example from the URL. */
  value: string;
  onCommit: (value: string) => void;
  delay?: number;
}

/** A text input that commits after the user stops typing, and follows outside changes to `value`. */
export function DebouncedTextInput({ value, onCommit, delay = 350, ...props }: DebouncedTextInputProps) {
  const [draft, setDraft] = useState(value);
  const [committed, setCommitted] = useState(value);
  const commit = useDebouncedCallback((v: string) => onCommit(v), delay);

  // The value changed from outside (a link, the back button): show it.
  if (value !== committed) {
    setCommitted(value);
    setDraft(value);
  }

  return (
    <TextInput
      {...props}
      value={draft}
      onChange={(e) => {
        setDraft(e.currentTarget.value);
        commit(e.currentTarget.value);
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') commit.flush();
      }}
      rightSection={
        draft ? (
          <CloseButton
            size="sm"
            aria-label={`Clear ${typeof props.label === 'string' ? props.label.toLowerCase() : 'filter'}`}
            onClick={() => {
              commit.cancel();
              setDraft('');
              onCommit('');
            }}
          />
        ) : null
      }
    />
  );
}
