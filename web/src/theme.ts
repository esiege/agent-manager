import { createTheme, Tooltip } from '@mantine/core';

export const theme = createTheme({
  primaryColor: 'indigo',
  defaultRadius: 'md',
  fontFamilyMonospace: 'ui-monospace, "Cascadia Code", "SF Mono", Menlo, Consolas, monospace',
  components: {
    Tooltip: Tooltip.extend({
      defaultProps: { openDelay: 250, withArrow: true, events: { hover: true, focus: true, touch: false } },
    }),
  },
});
