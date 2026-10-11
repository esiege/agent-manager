import { Text, Tooltip, type TextProps } from '@mantine/core';
import type { ApiRequestError } from '../lib/api';
import { formatAbsolute, formatAgo, useAgo, useClientNow } from '../lib/time';

/** "3m ago", with the full date and time in a tooltip. */
export function RelativeTime({ iso, ...props }: { iso: string | null | undefined } & TextProps) {
  const ago = useAgo(iso);
  if (!iso) {
    return (
      <Text span size="sm" c="dimmed" {...props}>
        –
      </Text>
    );
  }
  return (
    <Tooltip label={formatAbsolute(iso)}>
      <Text component="time" dateTime={iso} size="sm" style={{ whiteSpace: 'nowrap' }} {...props}>
        {ago}
      </Text>
    </Tooltip>
  );
}

/** "Updated 3s ago", or why the last refresh failed. */
export function UpdatedAgo({ updatedAt, error }: { updatedAt: number | null; error?: ApiRequestError | null }) {
  const now = useClientNow();
  if (updatedAt === null) return null;
  const ago = formatAgo(now - updatedAt);
  if (error) {
    return (
      <Tooltip label={error.message} multiline maw={360}>
        <Text size="xs" c="red" aria-live="polite">
          Couldn't refresh. Updated {ago}
        </Text>
      </Tooltip>
    );
  }
  return (
    <Text size="xs" c="dimmed" style={{ whiteSpace: 'nowrap' }}>
      Updated {ago}
    </Text>
  );
}
