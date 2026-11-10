#!/usr/bin/env node
/**
 * Prepare the pinned, self-hosted assets for the independent browser renderer.
 *
 * This script only downloads and copies files. It never executes generated
 * Python, never starts Pyodide, and never renders a scene. Every downloaded file
 * is checked against a fixed SHA-256 before it is written to the ignored asset
 * directory.
 *
 * Run from the frontend package:
 *   npm run prepare:browser-renderer
 * or directly:
 *   node scripts/browser-rendering/prepare-assets.mjs
 */

import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { copyFile, mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '..', '..');
const FRONTEND_ROOT = join(REPO_ROOT, 'frontend');
const ASSET_ROOT = join(FRONTEND_ROOT, 'browser-rendering-assets');
const VENDOR_ROOT = join(ASSET_ROOT, 'vendor');
const PYODIDE_DIR = join(VENDOR_ROOT, 'pyodide');
const WHEEL_DIR = join(VENDOR_ROOT, 'wheels');
const PYTHON_DIR = join(VENDOR_ROOT, 'python');

const PYODIDE_VERSION = '314.0.7';
const MANIMGX_VERSION = '0.1.1';
const PYODIDE_BASE = `https://cdn.jsdelivr.net/pyodide/v${PYODIDE_VERSION}/full/`;

const PYODIDE_FILES = [
  {
    file: 'pyodide.mjs',
    sha256: '6f1d60f7bf529beb300f0f47983c921d3982363640ba20af0e38efdddbc66109',
  },
  {
    file: 'pyodide.asm.mjs',
    sha256: 'f7cdc8ece80678ceb712f8e65ebe6d3a83203a180c399865f49612a051693635',
  },
  {
    file: 'pyodide.asm.wasm',
    sha256: 'cc36e3cab04fdfc9a63ff13eb52eae2b911bf46c025cc7b281f394bd3de1d5e6',
  },
  {
    file: 'python_stdlib.zip',
    sha256: 'fa1957e5777068fc4f7437f96d860ae2fbe9c19732ba06c84e004ec16dd7dd7a',
  },
  {
    file: 'pyodide-lock.json',
    sha256: '5dc2fc119108bc148c7457dc86e7675b5c87e1cafd420b9c34c1eaef7b36c010',
  },
  {
    file: 'micropip-0.11.1-py3-none-any.whl',
    sha256: 'e2d52886594fd4cd0d0847110a1c34ae0134d3a970eb4496d3b5eb31ee2d8af6',
  },
  {
    file: 'numpy-2.4.6-cp314-cp314-pyemscripten_2026_0_wasm32.whl',
    sha256: 'a292c1f5d7d8a2208cd5e94fc467604c131cabcd2fc14fed6eefde121e7fabdf',
  },
  {
    file: 'pillow-12.2.0-cp314-cp314-pyemscripten_2026_0_wasm32.whl',
    sha256: 'e29838b7a756e4ee0f27a9cfa9a387ee0dfa2e9dd44be2dd595130b9f9d93ac3',
  },
  {
    file: 'typing_extensions-4.15.0-py3-none-any.whl',
    sha256: '4fec68770a05408e668a4fa53d6bf4f0f684b9dacf820c7c5d6e97d3ad225e29',
  },
];

const WHEELS = [
  {
    name: 'isosurfaces',
    version: '0.1.2',
    file: 'isosurfaces-0.1.2-py3-none-any.whl',
    url: 'https://files.pythonhosted.org/packages/b1/68/d5e9e6e0d6e43107d8393d2ee3d231dbb597bf93052c6f3117b313724980/isosurfaces-0.1.2-py3-none-any.whl',
    sha256: '525a49ba93f4dbc35303cd2faf30976af0f99d9274cfa2787aec016b8ef96c64',
  },
  {
    name: 'manimgx-fonts',
    version: '2026.9.26.post1',
    file: 'manimgx_fonts-2026.9.26.post1-py3-none-any.whl',
    url: 'https://files.pythonhosted.org/packages/aa/2f/d7283e708fb06528e891d363e5380579209d98d3a6d1a98e25fdf5c2cdda/manimgx_fonts-2026.9.26.post1-py3-none-any.whl',
    sha256: 'e5e21178263ddec3eef9414d2b52a1c90ac01062d3e9067460f3359f854c3e17',
  },
  {
    name: 'manimgx-fonts-cjk',
    version: '2026.9.26.post1',
    file: 'manimgx_fonts_cjk-2026.9.26.post1-py3-none-any.whl',
    url: 'https://files.pythonhosted.org/packages/82/a3/7661a1cc0ed7b49420eb07fb9cfbf2430b33c51d080c81d5c761da93bda3/manimgx_fonts_cjk-2026.9.26.post1-py3-none-any.whl',
    sha256: '05d5584c73877f37427cf0ca8067f5bacea2b596c7be79e8aedd634bb9f2b666',
  },
  {
    name: 'manimgx',
    version: MANIMGX_VERSION,
    file: 'manimgx-0.1.1-cp313-abi3-pyemscripten_2026_0_wasm32.whl',
    url: 'https://files.pythonhosted.org/packages/4f/82/d9ccd9a547fdc7b74ce47d7a81f55c8d1ae1d72f024a3ece0a18a8dc34be/manimgx-0.1.1-cp313-abi3-pyemscripten_2026_0_wasm32.whl',
    sha256: 'ef8255890eeaa7281f15afe40c727b5df94199020003f5b698bf18aae94f92ae',
  },
  {
    name: 'svgelements',
    version: '1.9.6',
    file: 'svgelements-1.9.6-py2.py3-none-any.whl',
    url: 'https://files.pythonhosted.org/packages/48/2c/6c9bb53db56c8a12a736d2158a8b842a5993b96daabc29d90a098e840280/svgelements-1.9.6-py2.py3-none-any.whl',
    sha256: '8a5cf2cc066d98e713d5b875b1d6e5eeb9b92e855e835ebd7caab2713ae1dcad',
  },
];

const MAX_DOWNLOAD_BYTES = 128 * 1024 * 1024;
const force = process.argv.includes('--force');

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

async function exists(path) {
  try {
    return (await stat(path)).isFile();
  } catch {
    return false;
  }
}

async function localHashMatches(path, expected) {
  if (!(await exists(path))) return false;
  return sha256(await readFile(path)) === expected;
}

async function download(url, destination, expected, label) {
  if (!force && (await localHashMatches(destination, expected))) {
    console.log(`ok   ${label}`);
    return;
  }
  const response = await fetch(url, { redirect: 'follow' });
  if (!response.ok) {
    throw new Error(`${label}: HTTP ${response.status} from ${url}`);
  }
  const declared = Number(response.headers.get('content-length') ?? '0');
  if (declared > MAX_DOWNLOAD_BYTES) {
    throw new Error(`${label}: declared size ${declared} exceeds the limit`);
  }
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.byteLength === 0 || bytes.byteLength > MAX_DOWNLOAD_BYTES) {
    throw new Error(`${label}: invalid download size ${bytes.byteLength}`);
  }
  const digest = sha256(bytes);
  if (digest !== expected) {
    throw new Error(`${label}: SHA-256 mismatch (expected ${expected}, received ${digest})`);
  }
  const temporary = `${destination}.tmp-${process.pid}`;
  await writeFile(temporary, bytes);
  await rename(temporary, destination);
  console.log(`get  ${label} (${bytes.byteLength} bytes)`);
}

async function main() {
  await mkdir(PYODIDE_DIR, { recursive: true });
  await mkdir(WHEEL_DIR, { recursive: true });
  await mkdir(PYTHON_DIR, { recursive: true });

  for (const entry of PYODIDE_FILES) {
    await download(
      `${PYODIDE_BASE}${entry.file}`,
      join(PYODIDE_DIR, entry.file),
      entry.sha256,
      `pyodide/${entry.file}`,
    );
  }
  for (const wheel of WHEELS) {
    await download(
      wheel.url,
      join(WHEEL_DIR, wheel.file),
      wheel.sha256,
      `wheel/${wheel.file}`,
    );
  }

  const narrationSource = join(REPO_ROOT, 'src', 'rendering', 'manim', 'narration_runtime.py');
  const narrationBytes = await readFile(narrationSource);
  if (narrationBytes.byteLength === 0) {
    throw new Error('src/rendering/manim/narration_runtime.py is empty');
  }
  const narrationTarget = join(PYTHON_DIR, 'narration_runtime.py');
  if (force || !(await localHashMatches(narrationTarget, sha256(narrationBytes)))) {
    const temporary = `${narrationTarget}.tmp-${process.pid}`;
    await writeFile(temporary, narrationBytes);
    await rename(temporary, narrationTarget);
    console.log('copy src/rendering/manim/narration_runtime.py -> vendor/python/');
  } else {
    console.log('ok   narration_runtime.py');
  }

  const noticeSource = join(
    FRONTEND_ROOT,
    'src',
    'features',
    'browser-rendering',
    'third-party',
    'manimgx',
  );
  const noticeTarget = join(VENDOR_ROOT, 'third-party', 'manimgx');
  await mkdir(noticeTarget, { recursive: true });
  for (const name of ['LICENSE', 'PROVENANCE.txt']) {
    await copyFile(join(noticeSource, name), join(noticeTarget, name));
  }
  console.log('copy third-party/manimgx notices -> vendor/third-party/manimgx/');

  const manifest = {
    schema: 'manimcat.browser-rendering-assets.v1',
    generatedBy: 'scripts/browser-rendering/prepare-assets.mjs',
    engine: {
      manimgx: MANIMGX_VERSION,
      pyodide: PYODIDE_VERSION,
    },
    pyodide: {
      indexUrl: 'pyodide/',
      files: [
        ...PYODIDE_FILES.map((entry) => ({
          file: entry.file,
          sha256: entry.sha256,
        })),
        ...WHEELS.map((wheel) => ({
          file: `../wheels/${wheel.file}`,
          sha256: wheel.sha256,
        })),
      ],
    },
    wheels: WHEELS.map((wheel) => ({
      name: wheel.name,
      version: wheel.version,
      file: `wheels/${wheel.file}`,
      sha256: wheel.sha256,
    })),
    python: {
      narrationRuntime: {
        file: 'python/narration_runtime.py',
        sha256: sha256(narrationBytes),
      },
    },
  };
  const manifestPath = join(VENDOR_ROOT, 'manifest.json');
  const temporary = `${manifestPath}.tmp-${process.pid}`;
  await writeFile(temporary, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  await rename(temporary, manifestPath);
  console.log(`write ${manifestPath}`);
  console.log(
    [
      '',
      'Prepared pinned browser renderer assets.',
      `  Pyodide ${PYODIDE_VERSION}`,
      `  manimgx ${MANIMGX_VERSION} + manimgx-fonts-cjk 2026.9.26.post1`,
      '  No Python, Pyodide or scene code was executed.',
    ].join('\n'),
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
