/**
 * Trims the ONNX Runtime wasm package to the files this deployment loads.
 *
 * `onnxruntime-web` ships every execution provider (JSPI, asyncify, WebGPU, WebNN, WebGL)
 * plus the unbundled TypeScript source and source maps: 136MB of a package we use for one
 * wasm backend. Run this in the same layer as `npm install`, otherwise the deleted bytes
 * stay in the image.
 */
import fs from 'node:fs'
import path from 'node:path'

const PACKAGE_DIRECTORY = path.join(process.cwd(), 'node_modules', 'onnxruntime-web')

/** Everything else in the package is unused: `require('onnxruntime-web')` resolves the
 *  first entry, and the wasm backend loads the other three from `dist` at runtime. */
const KEEP = new Set([
  'package.json',
  'types.d.ts',
  'dist/ort.node.min.js',
  'dist/ort.node.min.mjs',
  'dist/ort-wasm-simd-threaded.mjs',
  'dist/ort-wasm-simd-threaded.wasm'
])

function listFiles(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(directory, entry.name)
    return entry.isDirectory() ? listFiles(full) : [full]
  })
}

function listDirectories(directory) {
  return fs
    .readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .flatMap((entry) => {
      const full = path.join(directory, entry.name)
      return [full, ...listDirectories(full)]
    })
}

if (!fs.existsSync(PACKAGE_DIRECTORY)) {
  throw new Error(`onnxruntime-web is not installed at ${PACKAGE_DIRECTORY}`)
}

const files = listFiles(PACKAGE_DIRECTORY)
for (const relative of KEEP) {
  if (!files.includes(path.join(PACKAGE_DIRECTORY, relative))) {
    throw new Error(`onnxruntime-web is missing ${relative}; the runtime cannot load without it`)
  }
}

let keptBytes = 0
let removedBytes = 0
for (const file of files) {
  const relative = path.relative(PACKAGE_DIRECTORY, file).split(path.sep).join('/')
  const size = fs.statSync(file).size
  if (KEEP.has(relative)) {
    keptBytes += size
  } else {
    removedBytes += size
    fs.rmSync(file)
  }
}

// Directories left empty by the deletes carry no data, but they would still list the
// package as a tree of dead paths.
for (const directory of listDirectories(PACKAGE_DIRECTORY).sort((left, right) => right.length - left.length)) {
  if (fs.readdirSync(directory).length === 0) {
    fs.rmdirSync(directory)
  }
}

const megabytes = (bytes) => `${(bytes / 1048576).toFixed(2)}MB`
console.log(`onnxruntime-web: kept ${megabytes(keptBytes)}, removed ${megabytes(removedBytes)}`)
