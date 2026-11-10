#!/usr/bin/env node
/**
 * Start the renderer-only Vite dev server on 5174 using the shared frontend config.
 * Assets and the patched engine are prepared first; no scene, Pyodide or render runs.
 * The main 5173 server keeps its existing proxy and is started separately with `npm run dev`.
 */

import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '..', '..');
const FRONTEND_ROOT = join(REPO_ROOT, 'frontend');
const requireFromFrontend = createRequire(join(FRONTEND_ROOT, 'package.json'));
const vitePackage = requireFromFrontend.resolve('vite/package.json');
const viteBin = join(dirname(vitePackage), 'bin', 'vite.js');

function run(command, args, cwd, label) {
  const result = spawnSync(command, args, { cwd, stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${label} exited with status ${result.status ?? 'unknown'}`);
  }
}

run(process.execPath, [join(HERE, 'prepare-assets.mjs')], REPO_ROOT, 'asset preparation');
run(process.execPath, [join(HERE, 'build-engine.mjs')], REPO_ROOT, 'browser engine build');

const result = spawnSync(
  process.execPath,
  [viteBin, '--mode', 'renderer', ...process.argv.slice(2)],
  { cwd: FRONTEND_ROOT, stdio: 'inherit' },
);
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
