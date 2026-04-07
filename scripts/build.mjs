import * as esbuild from 'esbuild';
import { chmod, mkdir } from 'fs/promises';
import { resolve } from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');

await mkdir(resolve(root, 'dist'), { recursive: true });

const sharedConfig = {
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  // Keep all node_modules external — they'll be installed as real deps
  packages: 'external',
  // Resolve the internal workspace package by path so it gets bundled
  alias: {
    '@starnose/proxy': resolve(root, 'packages/proxy/src/index.ts'),
  },
};

// CLI binary
await esbuild.build({
  ...sharedConfig,
  entryPoints: [resolve(root, 'packages/cli/src/index.ts')],
  outfile: resolve(root, 'dist/bin.js'),
  jsx: 'automatic',
});

// Proxy daemon — separate process spawned by `snose on`
await esbuild.build({
  ...sharedConfig,
  entryPoints: [resolve(root, 'packages/proxy/src/daemon.ts')],
  outfile: resolve(root, 'dist/proxy.js'),
  banner: { js: '#!/usr/bin/env node' },
  // alias daemon.ts entry to proxy source so internal imports resolve
  alias: {
    '@starnose/proxy': resolve(root, 'packages/proxy/src/index.ts'),
  },
});

await chmod(resolve(root, 'dist/bin.js'), 0o755);
await chmod(resolve(root, 'dist/proxy.js'), 0o755);

console.log('built dist/bin.js and dist/proxy.js');
