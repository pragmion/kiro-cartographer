#!/usr/bin/env node
// Bundle the server into a single self-contained JavaScript file.
// This produces dist/server.js with all dependencies inlined, so the
// power can be installed and run without an extra `npm install` step.

import { build } from 'esbuild';

await build({
  entryPoints: ['src/server.ts'],
  bundle: true,
  platform: 'node',
  target: 'node18',
  // CJS format avoids the "dynamic require" issue when bundling CommonJS deps.
  // We add a shebang manually below.
  format: 'cjs',
  outfile: 'dist/server.cjs',
  external: [],
  minify: false,
  sourcemap: 'inline',
  logLevel: 'info',
});

// Prepend shebang so the file is directly executable on POSIX systems.
const fs = await import('node:fs/promises');
const path = 'dist/server.cjs';
const original = await fs.readFile(path, 'utf8');
// Strip any shebang esbuild may have inserted, then add ours at the very top.
const stripped = original.replace(/^#![^\n]*\n/, '');
await fs.writeFile(path, '#!/usr/bin/env node\n' + stripped, 'utf8');
await fs.chmod(path, 0o755);

console.log('Bundle written to dist/server.cjs');
