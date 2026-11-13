import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['shared/test/**/*.test.ts', 'api/test/**/*.test.ts', 'reporter/test/**/*.test.ts', 'web/test/**/*.test.ts'],
  },
});
