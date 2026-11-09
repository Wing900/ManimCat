import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { probeSandboxSupport, resolvePythonRuntime } from '../../rendering/sandbox'
import { executeManimCommand } from '../../utils/manim-executor'

const probe = probeSandboxSupport()
let prerequisite: string | undefined = probe.available ? undefined : probe.reason ?? 'sandbox unavailable'
if (!prerequisite) {
  try {
    const runtime = resolvePythonRuntime({ envName: 'MANIMGX_PYTHON' })
    // Only trusted dependency discovery runs here, never submitted scene code.
    const result = spawnSync(runtime.executable, ['-c', 'import sys; assert sys.version_info >= (3, 13); import manimgx'], {
      encoding: 'utf8', timeout: 20_000,
    })
    if (result.status !== 0) prerequisite = `ManimGX/Python 3.13+ unavailable: ${result.stderr || result.error?.message || result.status}`
  } catch (error) {
    prerequisite = error instanceof Error ? error.message : String(error)
  }
}

// Staging/release hosts can require real integration instead of accepting skips.
const requireIntegration = process.env.MANIMCAT_REQUIRE_SANDBOX_TESTS === '1'

function silentWav(): Buffer {
  const samples = 1600 // 0.1 seconds, 16 kHz mono PCM16
  const bytes = Buffer.alloc(44 + samples * 2)
  bytes.write('RIFF', 0)
  bytes.writeUInt32LE(bytes.length - 8, 4)
  bytes.write('WAVEfmt ', 8)
  bytes.writeUInt32LE(16, 16)
  bytes.writeUInt16LE(1, 20)
  bytes.writeUInt16LE(1, 22)
  bytes.writeUInt32LE(16000, 24)
  bytes.writeUInt32LE(32000, 28)
  bytes.writeUInt16LE(2, 32)
  bytes.writeUInt16LE(16, 34)
  bytes.write('data', 36)
  bytes.writeUInt32LE(samples * 2, 40)
  return bytes
}

test('ManimGX renders an image and narrated video through the mandatory sandbox', {
  skip: prerequisite && !requireIntegration ? prerequisite : false,
}, async () => {
  assert.equal(prerequisite, undefined, `Real sandbox integration is required: ${prerequisite}`)
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sandbox-manim-'))
  try {
    const codeFile = path.join(root, 'scene.py')
    fs.writeFileSync(codeFile, 'from manimgx import *\nclass MainScene(Scene):\n    def construct(self):\n        self.add(Dot())\n        self.wait(0.1)\n')
    const audioPath = path.join(root, 'narration.wav')
    fs.writeFileSync(audioPath, silentWav())
    const manifest = path.join(root, 'manifest.json')
    fs.writeFileSync(manifest, JSON.stringify({ version: 1, audioPath, duration: 0.1, cues: {}, segments: [] }))
    for (const format of ['png', 'mp4'] as const) {
      const tempDir = path.join(root, format)
      fs.mkdirSync(tempDir)
      const syncReport = path.join(tempDir, 'sync-report.json')
      const result = await executeManimCommand(codeFile, {
        jobId: `sandbox-smoke-${format}`, quality: 'low', frameRate: 10, format,
        tempDir, mediaDir: path.join(tempDir, 'media'), timeoutMs: 60_000,
        ...(format === 'mp4' ? { narrationManifestPath: manifest, narrationSyncReportPath: syncReport } : {}),
      })
      assert.equal(result.success, true, result.stderr)
      assert.ok(result.outputPath)
      assert.ok(fs.lstatSync(result.outputPath!).isFile())
      assert.ok(fs.statSync(result.outputPath!).size > 0)
      if (format === 'png') {
        assert.deepEqual([...fs.readFileSync(result.outputPath!).subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10])
      } else {
        const report = JSON.parse(fs.readFileSync(syncReport, 'utf8'))
        assert.equal(report.status, 'ok')
        assert.equal(report.manifestPath, '/input/narration/manifest.json')
        assert.ok(report.audioPath.startsWith('/input/narration/'))
      }
      assert.equal(fs.existsSync(path.join(tempDir, 'sandbox')), false)
    }
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})
