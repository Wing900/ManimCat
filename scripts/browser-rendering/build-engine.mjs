#!/usr/bin/env node
/**
 * Build the pinned ManimGX browser WebAssembly engine with the clean image-readback
 * adapter. This is BUILD-ONLY work: it compiles Rust and generates wasm-bindgen JS.
 * It never executes Python, Pyodide, a scene or a render.
 *
 * The upstream engine embedded in the Pyodide wheel has no clean-frame readback API:
 * `web.rs` exports `Player`/`init` only and `Player.draw` composites the player face
 * (controls, timeline, help, status) over the film. The small patch in
 * engine-patch/ adds `Player.render_image(width, height)`, which copies the finished
 * take's final film texture into a MAP_READ buffer and maps it asynchronously. The
 * native/narration runner and all existing video methods are unchanged.
 *
 * Output is written to the ignored `frontend/browser-rendering-assets/engine/`
 * directory and recorded in the pinned asset manifest. No toolchain, source tree,
 * node_modules or WASM is committed.
 *
 * Reproducible recipe:
 *   - upstream tarball pinned by commit and SHA-256;
 *   - one unified patch pinned by SHA-256;
 *   - Docker image pinned by digest; Rust 1.90.0; wasm-bindgen 0.2.128;
 *   - Cargo.lock from the upstream tag and `--locked`;
 *   - target directory inside the workspace's excluded `rust/target`.
 */

import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import {
  copyFile,
  mkdir,
  readFile,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '..', '..');
const FRONTEND_ROOT = join(REPO_ROOT, 'frontend');
const ASSET_ROOT = join(FRONTEND_ROOT, 'browser-rendering-assets');
const BUILD_ROOT = join(ASSET_ROOT, '.engine-build');
const SOURCE_ROOT = join(BUILD_ROOT, 'src');
const CARGO_HOME = join(BUILD_ROOT, 'cargo-home');
const OUT_ROOT = join(BUILD_ROOT, 'out');
const TARBALL = join(BUILD_ROOT, 'manimgx-src.tar.gz');
const PATCH = join(HERE, 'engine-patch', '0001-clean-image-readback.patch');
const FINAL_ROOT = join(ASSET_ROOT, 'engine');
const MANIFEST = join(ASSET_ROOT, 'vendor', 'manifest.json');

const UPSTREAM_COMMIT = '0507708dc5d731478786de2f46ca8a1660d514d6';
const UPSTREAM_TARBALL = `https://codeload.github.com/academa-labs/manimgx/tar.gz/${UPSTREAM_COMMIT}`;
const UPSTREAM_TARBALL_SHA256 =
  '2637d63014ce10d16a092141e9436c3bf361dc2811bc688d02b2f1e221124de4';
const DOCKER_IMAGE =
  'rust:1.90-bookworm@sha256:3914072ca0c3b8aad871db9169a651ccfce30cf58303e5d6f2db16d1d8a7e58f';
const RUST_VERSION = '1.90.0';
const WASM_BINDGEN_VERSION = '0.2.128';
const WASM_TARGET = 'wasm32-unknown-unknown';
const MAX_SOURCE_BYTES = 160 * 1024 * 1024;
const force = process.argv.includes('--force');
const prebuiltIndex = process.argv.indexOf('--prebuilt-dir');
const prebuiltRoot =
  prebuiltIndex >= 0 && process.argv[prebuiltIndex + 1]
    ? resolve(process.argv[prebuiltIndex + 1])
    : null;

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

async function fileSha256(path) {
  return sha256(await readFile(path));
}

async function isFile(path) {
  try {
    return (await stat(path)).isFile();
  } catch {
    return false;
  }
}

function hostPath(path) {
  return resolve(path).replace(/\\/g, '/');
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { stdio: 'inherit', ...options });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(
      `${command} ${args.join(' ')} exited with status ${result.status ?? 'unknown'}`,
    );
  }
}

function docker(args, options = {}) {
  run('docker', args, options);
}

async function ensureTarball() {
  if (await isFile(TARBALL)) {
    if ((await fileSha256(TARBALL)) === UPSTREAM_TARBALL_SHA256) {
      console.log('ok   pinned upstream source tarball');
      return;
    }
    await rm(TARBALL, { force: true });
  }
  console.log(`get  ${UPSTREAM_TARBALL}`);
  const response = await fetch(UPSTREAM_TARBALL, { redirect: 'follow' });
  if (!response.ok) {
    throw new Error(`upstream source download failed: HTTP ${response.status}`);
  }
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.byteLength === 0 || bytes.byteLength > MAX_SOURCE_BYTES) {
    throw new Error(`upstream source has an invalid size: ${bytes.byteLength}`);
  }
  const digest = sha256(bytes);
  if (digest !== UPSTREAM_TARBALL_SHA256) {
    throw new Error(
      `upstream source SHA-256 mismatch (expected ${UPSTREAM_TARBALL_SHA256}, received ${digest})`,
    );
  }
  await writeFile(TARBALL, bytes);
}

async function ensureSource(patchSha) {
  const markerPath = join(BUILD_ROOT, 'source.json');
  if (!force && (await isFile(markerPath)) && (await isFile(join(SOURCE_ROOT, 'rust/engine/Cargo.toml')))) {
    const marker = JSON.parse(await readFile(markerPath, 'utf8'));
    if (
      marker.upstreamCommit === UPSTREAM_COMMIT &&
      marker.tarballSha256 === UPSTREAM_TARBALL_SHA256 &&
      marker.patchSha256 === patchSha
    ) {
      console.log('ok   patched upstream source tree');
      return;
    }
  }

  await ensureTarball();
  await rm(SOURCE_ROOT, { recursive: true, force: true });
  await mkdir(SOURCE_ROOT, { recursive: true });
  run('tar', ['-xzf', 'manimgx-src.tar.gz', '-C', 'src', '--strip-components=1'], { cwd: BUILD_ROOT });
  if (!(await isFile(join(SOURCE_ROOT, 'rust/engine/Cargo.toml')))) {
    throw new Error('upstream source tarball does not contain rust/engine');
  }
  // Apply inside the pinned container so the host needs no patch binary.
  docker([
    'run',
    '--rm',
    '-v',
    `${hostPath(SOURCE_ROOT)}:/src`,
    '-v',
    `${hostPath(PATCH)}:/patch/0001-clean-image-readback.patch:ro`,
    '-w',
    '/src',
    '-e',
    `PATCH_SHA256=${patchSha}`,
    DOCKER_IMAGE,
    'bash',
    '-c',
    'test "$(sha256sum /patch/0001-clean-image-readback.patch | cut -d" " -f1)" = "$PATCH_SHA256" && patch -p1 -d /src -i /patch/0001-clean-image-readback.patch',
  ]);
  await writeFile(
    markerPath,
    `${JSON.stringify(
      {
        upstreamCommit: UPSTREAM_COMMIT,
        tarballSha256: UPSTREAM_TARBALL_SHA256,
        patchSha256: patchSha,
      },
      null,
      2,
    )}\n`,
    'utf8',
  );
  console.log('ok   applied clean image-readback patch');
}

async function build(patchSha) {
  const buildMarker = join(BUILD_ROOT, 'build.json');
  if (
    !force &&
    (await isFile(buildMarker)) &&
    (await isFile(join(OUT_ROOT, 'engine.js'))) &&
    (await isFile(join(OUT_ROOT, 'engine_bg.wasm')))
  ) {
    const marker = JSON.parse(await readFile(buildMarker, 'utf8'));
    if (
      marker.patchSha256 === patchSha &&
      marker.dockerImage === DOCKER_IMAGE &&
      marker.wasmBindgen === WASM_BINDGEN_VERSION &&
      marker.rust === RUST_VERSION
    ) {
      const [js, wasm] = await Promise.all([
        fileSha256(join(OUT_ROOT, 'engine.js')),
        fileSha256(join(OUT_ROOT, 'engine_bg.wasm')),
      ]);
      if (marker.jsSha256 === js && marker.wasmSha256 === wasm) {
        console.log('ok   patched engine build cache');
        return { jsSha256: js, wasmSha256: wasm };
      }
    }
  }

  await mkdir(CARGO_HOME, { recursive: true });
  console.log('== compiling the pinned browser engine (Rust -> wasm32) ==');
  docker([
    'run',
    '--rm',
    '-v',
    `${hostPath(SOURCE_ROOT)}:/src`,
    '-v',
    `${hostPath(CARGO_HOME)}:/cargo-home`,
    '-w',
    '/src/rust/engine',
    '-e',
    'CARGO_HOME=/cargo-home',
    DOCKER_IMAGE,
    'bash',
    '-c',
    [
      '/usr/local/cargo/bin/rustup target add wasm32-unknown-unknown &&',
      '/usr/local/cargo/bin/cargo build --locked --lib --release',
      `--target ${WASM_TARGET}`,
      '--no-default-features --features web',
      '--target-dir /src/rust/target',
    ].join(' '),
  ]);

  console.log('== generating wasm-bindgen JS (pinned 0.2.128) ==');
  const wasmBindgen = join(CARGO_HOME, 'bin', 'wasm-bindgen');
  if (!(await isFile(wasmBindgen))) {
    console.log('== installing wasm-bindgen-cli 0.2.128 ==');
    docker([
      'run',
      '--rm',
      '-v',
      `${hostPath(CARGO_HOME)}:/cargo-home`,
      '-e',
      'CARGO_HOME=/cargo-home',
      DOCKER_IMAGE,
      'bash',
      '-c',
      `/usr/local/cargo/bin/cargo install wasm-bindgen-cli --version ${WASM_BINDGEN_VERSION} --locked`,
    ]);
  }
  await rm(OUT_ROOT, { recursive: true, force: true });
  await mkdir(OUT_ROOT, { recursive: true });
  docker([
    'run',
    '--rm',
    '-v',
    `${hostPath(SOURCE_ROOT)}:/src`,
    '-v',
    `${hostPath(CARGO_HOME)}:/cargo-home`,
    '-v',
    `${hostPath(OUT_ROOT)}:/out`,
    '-e',
    'CARGO_HOME=/cargo-home',
    DOCKER_IMAGE,
    'bash',
    '-c',
    [
      `/cargo-home/bin/wasm-bindgen --target web --out-dir /out --out-name engine`,
      '--no-typescript --omit-default-module-path',
      `/src/rust/target/${WASM_TARGET}/release/_engine.wasm`,
    ].join(' '),
  ]);
  const jsSha256 = await fileSha256(join(OUT_ROOT, 'engine.js'));
  const wasmSha256 = await fileSha256(join(OUT_ROOT, 'engine_bg.wasm'));
  await writeFile(
    buildMarker,
    `${JSON.stringify(
      {
        upstreamCommit: UPSTREAM_COMMIT,
        patchSha256: patchSha,
        dockerImage: DOCKER_IMAGE,
        rust: RUST_VERSION,
        wasmBindgen: WASM_BINDGEN_VERSION,
        target: WASM_TARGET,
        jsSha256,
        wasmSha256,
      },
      null,
      2,
    )}\n`,
    'utf8',
  );
  return { jsSha256, wasmSha256 };
}

async function publish(result) {
  await rm(FINAL_ROOT, { recursive: true, force: true });
  await mkdir(FINAL_ROOT, { recursive: true });
  await copyFile(join(OUT_ROOT, 'engine.js'), join(FINAL_ROOT, 'engine.js'));
  await copyFile(join(OUT_ROOT, 'engine_bg.wasm'), join(FINAL_ROOT, 'engine_bg.wasm'));
  await copyFile(
    join(FRONTEND_ROOT, 'src/features/browser-rendering/third-party/manimgx/LICENSE'),
    join(FINAL_ROOT, 'LICENSE'),
  );
  await copyFile(join(HERE, 'engine-patch/PROVENANCE.txt'), join(FINAL_ROOT, 'PROVENANCE.txt'));

  if (!(await isFile(MANIFEST))) {
    throw new Error(
      'frontend/browser-rendering-assets/vendor/manifest.json is missing; run prepare-assets.mjs first',
    );
  }
  const manifest = JSON.parse(await readFile(MANIFEST, 'utf8'));
  manifest.engine = {
    ...(manifest.engine ?? {}),
    web: {
      commit: UPSTREAM_COMMIT,
      license: 'MIT',
      js: '../engine/engine.js',
      jsSha256: result.jsSha256,
      wasm: '../engine/engine_bg.wasm',
      wasmSha256: result.wasmSha256,
      rust: RUST_VERSION,
      wasmBindgen: WASM_BINDGEN_VERSION,
      dockerImage: DOCKER_IMAGE,
      patchSha256: await fileSha256(PATCH),
      sourceTarballSha256: UPSTREAM_TARBALL_SHA256,
    },
  };
  await writeFile(MANIFEST, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  console.log('ok   published engine/engine.js and engine/engine_bg.wasm');
  console.log('ok   recorded the patched engine in vendor/manifest.json');
}

async function main() {
  if (!(await isFile(PATCH))) {
    throw new Error(`missing engine patch: ${PATCH}`);
  }
  const patchSha = await fileSha256(PATCH);
  let result;
  if (prebuiltRoot) {
    const prebuiltJs = join(prebuiltRoot, 'engine.js');
    const prebuiltWasm = join(prebuiltRoot, 'engine_bg.wasm');
    if (!(await isFile(prebuiltJs)) || !(await isFile(prebuiltWasm))) {
      throw new Error(`prebuilt engine is incomplete: ${prebuiltRoot}`);
    }
    await rm(OUT_ROOT, { recursive: true, force: true });
    await mkdir(OUT_ROOT, { recursive: true });
    await copyFile(prebuiltJs, join(OUT_ROOT, 'engine.js'));
    await copyFile(prebuiltWasm, join(OUT_ROOT, 'engine_bg.wasm'));
    result = {
      jsSha256: await fileSha256(join(OUT_ROOT, 'engine.js')),
      wasmSha256: await fileSha256(join(OUT_ROOT, 'engine_bg.wasm')),
    };
    console.log(`ok   imported prebuilt engine from ${prebuiltRoot}`);
  } else {
    await mkdir(BUILD_ROOT, { recursive: true });
    await ensureSource(patchSha);
    result = await build(patchSha);
  }
  await publish(result);
  console.log(
    [
      '',
      `Browser engine ready: manimgx@${UPSTREAM_COMMIT} + clean image-readback patch`,
      '  Rust 1.90.0 / wasm-bindgen 0.2.128 / wasm32-unknown-unknown',
      '  Docker build only; no scene, Pyodide, browser or render was executed.',
    ].join('\n'),
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
