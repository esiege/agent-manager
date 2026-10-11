// Copy buttons (U-06).

import { ActionIcon, Button, Code, CopyButton, Group, Tooltip, type ButtonProps } from '@mantine/core';
import { IconCheck, IconCopy } from '@tabler/icons-react';
import type { ReactNode } from 'react';

interface CopyIconProps {
  value: string;
  /** What gets copied, for the tooltip and screen readers: "Copy id". */
  label?: string;
  size?: 'xs' | 'sm' | 'md';
}

export function CopyIcon({ value, label = 'Copy', size = 'sm' }: CopyIconProps) {
  return (
    <CopyButton value={value} timeout={1500}>
      {({ copied, copy }) => (
        <Tooltip label={copied ? 'Copied' : label}>
          <ActionIcon
            variant="subtle"
            color={copied ? 'teal' : 'gray'}
            size={size}
            onClick={copy}
            aria-label={copied ? 'Copied' : label}
          >
            {copied ? <IconCheck size={14} /> : <IconCopy size={14} />}
          </ActionIcon>
        </Tooltip>
      )}
    </CopyButton>
  );
}

interface CopyTextButtonProps extends Omit<ButtonProps, 'children' | 'leftSection'> {
  value: string;
  children: ReactNode;
}

/** A labelled button: "Copy onboarding sentence". */
export function CopyTextButton({ value, children, ...props }: CopyTextButtonProps) {
  return (
    <CopyButton value={value} timeout={2000}>
      {({ copied, copy }) => (
        <Button
          {...props}
          onClick={copy}
          color={copied ? 'teal' : props.color}
          leftSection={copied ? <IconCheck size={16} /> : <IconCopy size={16} />}
        >
          {copied ? 'Copied' : children}
        </Button>
      )}
    </CopyButton>
  );
}

/** A command or value in monospace, wrapped so all of it shows, with a copy button. */
export function CopyField({ value, label = 'Copy' }: { value: string; label?: string }) {
  return (
    <Group gap={4} wrap="nowrap" align="center" miw={0}>
      <Code style={{ flex: 1, minWidth: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-all', padding: '6px 8px' }}>
        {value}
      </Code>
      <CopyIcon value={value} label={label} />
    </Group>
  );
}
