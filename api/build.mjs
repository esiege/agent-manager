// Bundles the API into one file, so the deployed folder needs no node_modules.
// @azure/functions-core is supplied by the Functions host at run time and must stay external.
import { build } from 'esbuild';

await build({
  entryPoints: ['src/index.ts'],
  outfile: 'dist/index.js',
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'cjs',
  sourcemap: true,
  external: ['@azure/functions-core'],
  logLevel: 'info',
});
