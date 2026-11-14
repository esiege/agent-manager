import { createTheme, Tooltip, type MantineColorsTuple } from '@mantine/core';

// Ten shades that point at styles.css, which builds them from the color theme's numbers on
// <html>. That's how one theme pick re-tints every Mantine component. See Docs/CUSTOMIZATION.md.
const ramp = (name: string) => Array.from({ length: 10 }, (_, i) => `var(--am-${name}-${i})`) as unknown as MantineColorsTuple;

export const theme = createTheme({
  primaryColor: 'brand',
  primaryShade: 7,
  colors: {
    brand: ramp('brand'),
    brand2: ramp('brand2'),
    gray: ramp('gray'),
    dark: ramp('dark'),
  },
  defaultRadius: 'md',
  fontFamilyMonospace: 'ui-monospace, "Cascadia Code", "SF Mono", Menlo, Consolas, monospace',
  components: {
    Tooltip: Tooltip.extend({
      defaultProps: { openDelay: 250, withArrow: true, events: { hover: true, focus: true, touch: false } },
    }),
  },
});
