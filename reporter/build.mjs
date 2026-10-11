// Bundles agentctl into one file and copies it to the web app, which serves it at /agentctl.js.
import { copyFileSync, mkdirSync } from 'node:fs';
import { build } from 'esbuild';

await build({
  entryPoints: ['src/agentctl.ts'],
  outfile: 'dist/agentctl.js',
  bundle: true,
  platform: 'node',
  target: 'node18',
  format: 'cjs',
  banner: { js: '#!/usr/bin/env node' },
  logLevel: 'info',
});

mkdirSync('../web/public', { recursive: true });
copyFileSync('dist/agentctl.js', '../web/public/agentctl.js');
