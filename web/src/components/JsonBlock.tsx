import { Box, Code, Text } from '@mantine/core';
import { CopyIcon } from './Copy';

/** Pretty JSON with a copy button. */
export function JsonBlock({ value, label = 'Copy JSON', maxHeight = 480 }: { value: unknown; label?: string; maxHeight?: number }) {
  const isEmpty =
    value === null || value === undefined || (typeof value === 'object' && Object.keys(value as object).length === 0);
  if (isEmpty) {
    return (
      <Text size="sm" c="dimmed">
        None
      </Text>
    );
  }
  const text = JSON.stringify(value, null, 2);
  return (
    <Box pos="relative">
      <Code block style={{ maxHeight, overflow: 'auto', paddingRight: 40 }} tabIndex={0}>
        {text}
      </Code>
      <Box pos="absolute" top={6} right={6}>
        <CopyIcon value={text} label={label} />
      </Box>
    </Box>
  );
}
