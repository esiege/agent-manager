// The wordmark, inlined so its "Delux" tag takes the theme's primary color and its letters the
// text color. The file's own blue is what shows anywhere else (the README, for one).

import logoSvg from '../assets/logo.svg?raw';

const markup = logoSvg
  .replace('fill="#2563eb"', 'fill="var(--mantine-primary-color-filled)"')
  .replace('<svg ', '<svg height="100%" ');

export function Logo({ height }: { height: number }) {
  return <span style={{ display: 'block', height, lineHeight: 0 }} dangerouslySetInnerHTML={{ __html: markup }} />;
}
