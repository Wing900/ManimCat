import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import {
  publishNarrationForReuse,
  resolveNarrationSharedDirectory,
  resolveReusedNarration,
  resolveReusedNarrationForJob
} from '../../rendering/manim/narration-reuse'

function writeFixture(directory: string, audioName: string): {
  manifestPath: string
  audioPath: string
} {
  fs.mkdirSync(directory, { recursive: true })
  const audioPath = path.join(directory, audioName)
  fs.writeFileSync(audioPath, 'fake-pcm-audio')
  const manifestPath = path.join(directory, 'narration-manifest.json')
  fs.writeFileSync(
    manifestPath,
    JSON.stringify({
      version: 1,
      audioPath,
      duration: 12.5,
      segments: [{ id: 's1', start: 0, duration: 12.5, audioPath, cues: { 'cue-1': 3.2 } }],
      cues: { 'cue-1': 3.2 }
    })
  )
  return { manifestPath, audioPath }
}

test('publishes narration under the renderCacheKey bucket and reuses it for a new job id', () => {
  const key = `test-narration-reuse-${process.pid}-${Date.now()}`
  const fixtureDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'narration-reuse-src-'))
  const fixture = writeFixture(fixtureDirectory, 'narration.wav')
  const firstJob = 'job-original'
  const secondJob = 'job-quality-rerender'

  try {
    publishNarrationForReuse({
      renderCacheKey: key,
      jobId: firstJob,
      config: { enabled: true, voice: 'zh-CN-XiaoxiaoNeural', rate: '+0%' },
      assets: { manifestPath: fixture.manifestPath, audioPath: fixture.audioPath, duration: 12.5 }
    })

    const assets = resolveReusedNarration(key, secondJob)
    assert.ok(assets, 're-render must find the published narration')
    const sharedDirectory = resolveNarrationSharedDirectory(key, firstJob)
    assert.ok(assets.manifestPath.startsWith(sharedDirectory))
    assert.ok(assets.audioPath.startsWith(sharedDirectory))
    assert.equal(assets.duration, 12.5)
    assert.ok(fs.existsSync(assets.audioPath))

    const manifest = JSON.parse(fs.readFileSync(assets.manifestPath, 'utf8')) as {
      audioPath: string
      cues: Record<string, number>
    }
    assert.ok(manifest.audioPath.startsWith(sharedDirectory))
    assert.equal(manifest.cues['cue-1'], 3.2)

    // Re-publishing the same shared assets must be a no-op (quality change path).
    publishNarrationForReuse({
      renderCacheKey: key,
      jobId: secondJob,
      config: { enabled: true, voice: 'zh-CN-XiaoxiaoNeural', rate: '+0%' },
      assets
    })
    assert.ok(resolveReusedNarration(key, 'job-third'))

    // Both non-generating flows use this one decision: enabled video reuses, disabled/image stays silent.
    const enabledVideo = {
      narration: { enabled: true, voice: 'zh-CN-XiaoxiaoNeural', rate: '+0%' }
    }
    assert.ok(
      resolveReusedNarrationForJob({
        renderCacheKey: key,
        workspaceDirectory: undefined,
        jobId: 'job-pre-generated',
        videoConfig: enabledVideo,
        outputMode: 'video'
      })
    )
    assert.equal(
      resolveReusedNarrationForJob({
        renderCacheKey: key,
        workspaceDirectory: undefined,
        jobId: 'job-disabled',
        videoConfig: { narration: { ...enabledVideo.narration, enabled: false } },
        outputMode: 'video'
      }),
      undefined
    )
    assert.equal(
      resolveReusedNarrationForJob({
        renderCacheKey: key,
        workspaceDirectory: undefined,
        jobId: 'job-image',
        videoConfig: enabledVideo,
        outputMode: 'image'
      }),
      undefined
    )

    // A pointer that escapes the bucket is rejected: the browser never supplies a path,
    // and a tampered state file cannot make the renderer read one either.
    const statePath = path.join(sharedDirectory, 'narration-reuse.json')
    const state = JSON.parse(fs.readFileSync(statePath, 'utf8')) as {
      assets: { manifestPath: string; audioPath: string; duration: number }
    }
    state.assets.manifestPath = fixture.manifestPath
    fs.writeFileSync(statePath, JSON.stringify(state))
    assert.equal(resolveReusedNarration(key, 'job-fourth'), undefined)
  } finally {
    fs.rmSync(fixtureDirectory, { recursive: true, force: true })
    fs.rmSync(path.dirname(resolveNarrationSharedDirectory(key, firstJob)), {
      recursive: true,
      force: true
    })
  }
})
