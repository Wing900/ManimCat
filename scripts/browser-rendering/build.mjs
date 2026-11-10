#!/usr/bin/env node
/**
 * Build the single frontend artifact and prepare the isolated renderer deployment
 * directory. This never starts the main app, executes a scene, boots Pyodide or renders.
 *
 *   artifacts:
 *     ../public/index.html + assets (main site, unchanged base URL)
 *     frontend/dist-browser-renderer (same index.html/assets + renderer _headers/_redirects)
 *
 * The renderer deployment is a separate origin. Its headers are written only into
 * dist-browser-renderer so the main site never inherits frame-ancestors or the
 * renderer's restrictive CSP. The route is /renderer; the legacy HTML filename only
 * redirects. There is no second Vite build or standalone HTML entry.
 */

import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import {
  cpSync,
  existsSync,
  mkdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { securityHeaders } from './security-headers.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '..', '..');
const FRONTEND_ROOT = join(REPO_ROOT, 'frontend');
const requireFromFrontend = createRequire(join(FRONTEND_ROOT, 'package.json'));
const vitePackage = requireFromFrontend.resolve('vite/package.json');
const viteBin = join(dirname(vitePackage), 'bin', 'vite.js');
const prepareScript = join(HERE, 'prepare-assets.mjs');
const engineScript = join(HERE, 'build-engine.mjs');
const assetRoot = join(FRONTEND_ROOT, 'browser-rendering-assets');
const publicRoot = join(FRONTEND_ROOT, '..', 'public');
const rendererRoot = join(FRONTEND_ROOT, 'dist-browser-renderer');
const passthrough = process.argv.slice(2);
const preparationArgs = passthrough.includes('--force') ? ['--force'] : [];

function run(command, args, cwd, label) {
  const result = spawnSync(command, args, { cwd, stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${label} exited with status ${result.status ?? 'unknown'}`);
  }
}

console.log('== preparing pinned browser rendering assets ==');
run(process.execPath, [prepareScript, ...preparationArgs], REPO_ROOT, 'asset preparation');

console.log('== building the patched clean-image engine (build-only) ==');
run(process.execPath, [engineScript, ...passthrough], REPO_ROOT, 'browser engine build');

console.log('== building the shared frontend artifact ==');
run(process.execPath, [viteBin, 'build'], FRONTEND_ROOT, 'frontend build');

const html = join(publicRoot, 'index.html');
const assets = join(publicRoot, 'assets');
if (!existsSync(html) || !existsSync(assets)) {
  throw new Error(`The frontend build is incomplete; expected ${html} and ${assets}`);
}
if (!existsSync(join(assetRoot, 'vendor', 'manifest.json'))) {
  throw new Error('The prepared renderer asset manifest is missing');
}

// The renderer needs the pinned assets beside its HTML. Keep them off the main
// origin: generated scene code may load only resources from the dedicated origin.
const publicAssets = join(publicRoot, 'browser-rendering');
rmSync(publicAssets, { recursive: true, force: true });

// One build artifact, mirrored beside the renderer-only operator headers. The main
// public/ directory never receives _headers from this script.
rmSync(rendererRoot, { recursive: true, force: true });
mkdirSync(rendererRoot, { recursive: true });
cpSync(html, join(rendererRoot, 'index.html'));
cpSync(assets, join(rendererRoot, 'assets'), { recursive: true });
cpSync(assetRoot, join(rendererRoot, 'browser-rendering'), { recursive: true });

const mainOrigin = process.env.BROWSER_RENDERER_MAIN_ORIGIN?.trim();
const headers = mainOrigin
  ? securityHeaders(mainOrigin)
  : securityHeaders(null, { deny: true });
writeFileSync(join(rendererRoot, '_headers'), headers.headersFile, 'utf8');

// The renderer origin is dedicated: / is the frame route, and the retired standalone
// HTML name only redirects. There is no catch-all to index.html, so an unknown path
// cannot accidentally load the main application on this origin.
writeFileSync(
  join(rendererRoot, '_redirects'),
  [
    '# Renderer origin only. The main application is not served here.',
    '/browser-renderer.html  /renderer  301',
    '/renderer  /index.html  200',
    '/renderer/  /index.html  200',
    '/  /renderer  302',
    '',
  ].join('\n'),
  'utf8',
);

console.log(`
Renderer deployment prepared: ${rendererRoot}`);
console.log('The only HTML artifact is index.html; the renderer route is /renderer.');
console.log('Serve that directory on a separate origin from the main application.');
console.log('Configure VITE_BROWSER_RENDERER_URL with the full route, for example:');
console.log('  VITE_BROWSER_RENDERER_URL=https://renderer.example/renderer');
console.log('Set BROWSER_RENDERER_MAIN_ORIGIN to the main app origin when building to allow embedding;');
console.log('without it, _headers deny framing and the renderer cannot be embedded.');
console.log('Deploy _headers on HTML and every worker/module/WASM response.');
console.log('The main public/ directory intentionally receives no renderer _headers.');
