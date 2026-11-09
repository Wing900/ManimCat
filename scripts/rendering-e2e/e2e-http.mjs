#!/usr/bin/env node
/**
 * PR #10 HTTP end-to-end acceptance runner.
 *
 * Requires a running ManimCat app with an isolated Redis, real Python/bubblewrap,
 * ffmpeg, and a deterministic OpenAI-compatible stub at 127.0.0.1:19001. It never
 * uses a real provider or credentials.
 */
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'

const BASE = (process.env.BASE_URL || 'http://127.0.0.1:7860').replace(/\/$/, '')
const EVIDENCE = process.env.EVIDENCE_DIR || '/evidence'
const AUTH = `Bearer byok_${'a'.repeat(64)}`
const CLIENT = 'pr10-http-e2e'
const STUB_BASE = process.env.STUB_BASE_URL || 'http://127.0.0.1:19001/v1'
const CUSTOM_API = {
  apiUrl: STUB_BASE,
  apiKey: 'pr10-stub',
  model: 'pr10-stub',
}

const results = []
let failures = 0

function log(message) {
  console.log(message)
}

function record(name, pass, detail, evidence = undefined) {
  results.push({ name, pass, detail, ...(evidence ? { evidence } : {}) })
  if (!pass) failures += 1
  log(`${pass ? 'PASS' : 'FAIL'} ${name}${detail ? `: ${detail}` : ''}`)
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

async function api(route, options = {}) {
  const response = await fetch(`${BASE}${route}`, {
    method: options.method || 'GET',
    headers: {
      authorization: AUTH,
      'x-client-id': CLIENT,
      ...(options.body === undefined ? {} : { 'content-type': 'application/json' }),
      ...(options.headers || {}),
    },
    ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
  })
  const text = await response.text()
  let json
  try { json = text ? JSON.parse(text) : {} } catch { json = { raw: text } }
  if (!response.ok && options.allowError !== true) {
    throw new Error(`${options.method || 'GET'} ${route} -> ${response.status}: ${text.slice(0, 1200)}`)
  }
  return { status: response.status, json, text, headers: response.headers }
}

async function saveUrl(url, fileName) {
  const response = await fetch(`${BASE}${url}`)
  if (!response.ok) throw new Error(`fetch ${url} -> ${response.status}`)
  const bytes = Buffer.from(await response.arrayBuffer())
  const target = path.join(EVIDENCE, fileName)
  fs.writeFileSync(target, bytes)
  return { target, bytes }
}

function ffprobe(file) {
  const result = spawnSync('ffprobe', [
    '-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', file,
  ], { encoding: 'utf8' })
  if (result.status !== 0) throw new Error(`ffprobe failed: ${result.stderr}`)
  return JSON.parse(result.stdout)
}

function audioLevel(file) {
  const result = spawnSync('ffmpeg', [
    '-hide_banner', '-i', file, '-af', 'volumedetect', '-f', 'null', '-',
  ], { encoding: 'utf8' })
  const match = /mean_volume:\s*(-?\d+(?:\.\d+)?) dB/.exec(result.stderr || '')
  return match ? Number(match[1]) : null
}

function assertVideo(file, options = {}) {
  const probe = ffprobe(file)
  const streams = probe.streams || []
  const video = streams.find(stream => stream.codec_type === 'video')
  if (!video) throw new Error('no video stream')
  if (!Number.isFinite(Number(probe.format?.duration)) || Number(probe.format.duration) <= 0) {
    throw new Error(`invalid duration ${probe.format?.duration}`)
  }
  if (options.audio) {
    const audio = streams.find(stream => stream.codec_type === 'audio')
    if (!audio) throw new Error('narrated output has no audio stream')
    const level = audioLevel(file)
    if (level === null) throw new Error('could not measure audio level')
    if (level <= -60) throw new Error(`audio track is effectively silent (${level} dB)`)
    return { probe, video, audio, audioLevelDb: level }
  }
  return { probe, video }
}

function assertPng(bytes) {
  const signature = [137, 80, 78, 71, 13, 10, 26, 10]
  if (bytes.length < 8 || signature.some((value, index) => bytes[index] !== value)) {
    throw new Error('not a PNG signature')
  }
  return bytes.length
}

async function waitForJob(jobId, timeoutMs = 240_000) {
  const deadline = Date.now() + timeoutMs
  let last
  while (Date.now() < deadline) {
    const response = await api(`/api/jobs/${jobId}`)
    last = response.json
    if (last.status === 'completed' || last.status === 'failed') return last
    await sleep(1000)
  }
  throw new Error(`job ${jobId} did not finish: ${JSON.stringify(last)}`)
}

async function submitJob(body) {
  const response = await api('/api/generate', { method: 'POST', body })
  if (response.status !== 202 || !response.json.jobId) {
    throw new Error(`generate did not return 202/jobId: ${response.status} ${response.text.slice(0, 800)}`)
  }
  return response.json.jobId
}

async function waitForStudioRun(runId, timeoutMs = 240_000) {
  const deadline = Date.now() + timeoutMs
  let last
  while (Date.now() < deadline) {
    const response = await api(`/api/studio-agent/runs/${runId}`)
    last = response.json?.data?.run
    if (!last) throw new Error(`studio run response shape: ${response.text.slice(0, 800)}`)
    if (['completed', 'failed', 'cancelled'].includes(last.status)) return last
    await sleep(1000)
  }
  throw new Error(`studio run ${runId} did not finish: ${JSON.stringify(last)}`)
}

async function studioSnapshot(sessionId) {
  const response = await api(`/api/studio-agent/sessions/${sessionId}`)
  if (!response.json?.ok) throw new Error(`studio snapshot: ${response.text.slice(0, 800)}`)
  return response.json.data
}

async function studioCase(name, studioKind, inputText, expected) {
  const sessionResponse = await api('/api/studio-agent/sessions', {
    method: 'POST',
    body: { studioKind, title: `PR10 ${studioKind}` },
  })
  if (sessionResponse.status !== 200 || !sessionResponse.json?.ok) {
    throw new Error(`studio session creation failed: ${sessionResponse.text.slice(0, 800)}`)
  }
  const session = sessionResponse.json.data.session
  const runResponse = await api('/api/studio-agent/runs', {
    method: 'POST',
    body: {
      sessionId: session.id,
      inputText,
      customApiConfig: CUSTOM_API,
      providerConfig: CUSTOM_API,
      toolChoice: 'auto',
    },
  })
  if (runResponse.status !== 202 || !runResponse.json?.ok) {
    throw new Error(`studio run start failed: ${runResponse.status} ${runResponse.text.slice(0, 1000)}`)
  }
  const run = runResponse.json.data.run
  const finalRun = await waitForStudioRun(run.id)
  const snapshot = await studioSnapshot(session.id)
  const render = [...(snapshot.renders || [])].sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))[0]
  if (expected.runStatus !== 'any' && finalRun.status !== expected.runStatus) {
    throw new Error(`studio run status ${finalRun.status} != ${expected.runStatus}; render=${JSON.stringify(render)}`)
  }
  if (expected.renderStatus && render?.status !== expected.renderStatus) {
    throw new Error(`studio render status ${render?.status} != ${expected.renderStatus}; runError=${finalRun.error}`)
  }
  if (expected.media === 'video') {
    const attachment = (render?.attachments || []).find(item => String(item.mimeType || '').startsWith('video/') || /\.mp4$/i.test(String(item.path || '')))
    if (!attachment) throw new Error(`no completed video attachment: ${JSON.stringify(render)}`)
    const saved = await saveUrl(attachment.path, `${name}.mp4`)
    const info = assertVideo(saved.target, { audio: false })
    return { name, detail: `${attachment.path} ${info.video.codec_name} ${info.probe.format.duration}s`, evidence: saved.target }
  }
  if (expected.media === 'image') {
    const attachment = (render?.attachments || []).find(item => String(item.mimeType || '').startsWith('image/') || /^data:image\/png/i.test(String(item.path || '')))
    if (!attachment) throw new Error(`no completed image attachment: ${JSON.stringify(render)}`)
    let bytes
    if (String(attachment.path).startsWith('data:image/png;base64,')) {
      bytes = Buffer.from(String(attachment.path).slice('data:image/png;base64,'.length), 'base64')
    } else {
      bytes = (await saveUrl(attachment.path, `${name}.png`)).bytes
    }
    const target = path.join(EVIDENCE, `${name}.png`)
    fs.writeFileSync(target, bytes)
    const size = assertPng(bytes)
    return { name, detail: `image ${size} bytes`, evidence: target }
  }
  if (expected.media === 'failed') {
    const failedRender = (snapshot.renders || []).find(item => item.status === 'failed')
    if (!failedRender) throw new Error(`no failed render recorded: ${JSON.stringify(snapshot.renders)}`)
    return { name, detail: `render failed as required: ${failedRender.error || 'no public error'}`, evidence: undefined }
  }
  return { name, detail: finalRun.status, evidence: undefined }
}

async function main() {
  fs.mkdirSync(EVIDENCE, { recursive: true })

  const health = await api('/health')
  record('health', health.status === 200, `${health.status}`)

  // 1. Workflow video with real narration/TTS/mux/audio.
  {
    const jobId = await submitJob({
      concept: 'PR10 narrated dot',
      outputMode: 'video',
      quality: 'low',
      videoConfig: {
        frameRate: 10,
        narration: { enabled: true, voice: 'en-US-AriaNeural', rate: '+0%' },
        timeout: 180000,
      },
      customApiConfig: CUSTOM_API,
      providerConfig: CUSTOM_API,
    })
    const job = await waitForJob(jobId)
    if (job.status !== 'completed') throw new Error(`narrated job failed: ${JSON.stringify(job).slice(0, 2000)}`)
    const video = await saveUrl(job.video_url, 'workflow-narration.mp4')
    const info = assertVideo(video.target, { audio: true })
    const vttResponse = await fetch(`${BASE}${job.video_url.replace(/\.mp4$/, '.vtt')}`)
    const vtt = vttResponse.ok ? await vttResponse.text() : ''
    if (!vtt.trim()) throw new Error('missing WebVTT sidecar')
    fs.writeFileSync(path.join(EVIDENCE, 'workflow-narration.vtt'), vtt)
    record('workflow video narration', true, `${jobId} ${info.probe.format.duration}s audio=${info.audio.codec_name} mean=${info.audioLevelDb}dB vtt=${vtt.length}B`, video.target)
  }

  // 2. Workflow image via the real AI->YON block->ManimPNG path.
  {
    const jobId = await submitJob({
      concept: 'PR10 image dot',
      outputMode: 'image',
      quality: 'low',
      customApiConfig: CUSTOM_API,
      providerConfig: CUSTOM_API,
    })
    const job = await waitForJob(jobId)
    if (job.status !== 'completed' || !Array.isArray(job.image_urls) || job.image_urls.length === 0) {
      throw new Error(`image job did not complete with an image: ${JSON.stringify(job).slice(0, 2000)}`)
    }
    const image = await saveUrl(job.image_urls[0], 'workflow-image.png')
    const size = assertPng(image.bytes)
    record('workflow image', true, `${jobId} ${job.image_urls[0]} ${size}B`, image.target)
  }

  // 3. Edited rerender through /api/modify (real AI edit + render).
  {
    const sourceCode = [
      'from manimgx import *',
      '',
      'class MainScene(Scene):',
      '    def construct(self):',
      '        self.add(Dot())',
      '        self.wait(0.2)',
    ].join('\n')
    const response = await api('/api/modify', {
      method: 'POST',
      body: {
        concept: 'PR10 edited rerender',
        outputMode: 'video',
        quality: 'low',
        instructions: 'Replace the dot with a square.',
        code: sourceCode,
        customApiConfig: CUSTOM_API,
      providerConfig: CUSTOM_API,
        videoConfig: { frameRate: 10, timeout: 180000 },
      },
    })
    if (response.status !== 202 || !response.json.jobId) throw new Error(`modify rejected: ${response.status} ${response.text.slice(0, 800)}`)
    const job = await waitForJob(response.json.jobId)
    if (job.status !== 'completed') throw new Error(`edited job failed: ${JSON.stringify(job).slice(0, 2000)}`)
    if (!String(job.code || '').includes('Square')) throw new Error(`edited code did not contain Square(): ${String(job.code).slice(0, 500)}`)
    const video = await saveUrl(job.video_url, 'workflow-edited.mp4')
    const info = assertVideo(video.target, { audio: false })
    record('edited rerender', true, `${response.json.jobId} ${info.probe.format.duration}s Square present`, video.target)
  }

  // 4. Code retry: first render raises, AI patch produces a working video.
  {
    const jobId = await submitJob({
      concept: 'PR10_RETRY retry marker',
      outputMode: 'video',
      quality: 'low',
      videoConfig: { frameRate: 10, timeout: 180000 },
      customApiConfig: CUSTOM_API,
      providerConfig: CUSTOM_API,
    })
    const job = await waitForJob(jobId)
    if (job.status !== 'completed') throw new Error(`retry job failed: ${JSON.stringify(job).slice(0, 2000)}`)
    if (String(job.code || '').includes('PR10_RETRY')) throw new Error('retry job still contains the failing line')
    const video = await saveUrl(job.video_url, 'workflow-retry.mp4')
    const info = assertVideo(video.target, { audio: false })
    record('code retry', true, `${jobId} retry=${job.timings?.retry ?? 'unknown'} ${info.probe.format.duration}s`, video.target)
  }

  // 5. Cancellation of a genuinely active render.
  {
    const longCode = [
      'from manimgx import *',
      'import time',
      '',
      'class MainScene(Scene):',
      '    def construct(self):',
      '        time.sleep(120)',
    ].join('\n')
    const jobId = await submitJob({
      concept: 'PR10 cancellation',
      outputMode: 'video',
      quality: 'low',
      code: longCode,
      videoConfig: { frameRate: 10, timeout: 180000 },
      customApiConfig: CUSTOM_API,
      providerConfig: CUSTOM_API,
    })
    const activeDeadline = Date.now() + 30_000
    let active
    while (Date.now() < activeDeadline) {
      const response = await api(`/api/jobs/${jobId}`)
      active = response.json
      if (active.status === 'processing' && (active.stage === 'rendering' || active.stage === 'analyzing')) break
      await sleep(500)
    }
    if (active?.status !== 'processing') throw new Error(`job never became active: ${JSON.stringify(active)}`)
    const cancel = await api(`/api/jobs/${jobId}/cancel`, { method: 'POST', body: {} })
    if (cancel.status !== 200) throw new Error(`cancel route failed: ${cancel.status} ${cancel.text.slice(0, 500)}`)
    const job = await waitForJob(jobId, 30_000)
    const cancelled = job.status === 'failed' && (job.cancel_reason || job.error || '').match(/cancel/i)
    if (!cancelled) throw new Error(`job was not reported cancelled: ${JSON.stringify(job).slice(0, 1200)}`)
    await sleep(2500)
    record('cancellation', true, `${jobId} status=${job.status} reason=${job.cancel_reason || job.error}`, undefined)
  }

  // 6. Hostile source through the actual generate route: host file/env/process/network/read-only input.
  {
    const isolationCode = [
      'import os',
      'import socket',
      'from manimgx import *',
      '',
      'def check_isolation():',
      "    assert not os.path.exists('/etc/passwd'), 'host /etc/passwd is visible'",
      "    assert not os.path.exists('/app/package.json'), 'host app tree is visible'",
      "    assert os.environ.get('PR10_HOST_SECRET') is None, 'host environment secret leaked'",
      '    try:',
      "        with open('/input/blocked.txt', 'w') as handle:",
      "            handle.write('blocked')",
      '    except OSError:',
      '        pass',
      '    else:',
      "        raise AssertionError('/input is writable')",
      '    probe = socket.socket(socket.AF_INET, socket.SOCK_STREAM)',
      '    probe.settimeout(1)',
      '    try:',
      "        probe.connect(('127.0.0.1', 19001))",
      '    except OSError:',
      '        pass',
      '    else:',
      "        raise AssertionError('sandbox reached the host fixture port')",
      '    finally:',
      '        probe.close()',
      '',
      'check_isolation()',
      '',
      'class MainScene(Scene):',
      '    def construct(self):',
      '        self.add(Dot())',
      '        self.wait(0.2)',
    ].join('\n')
    const jobId = await submitJob({
      concept: 'PR10_ISOLATION hostile source',
      outputMode: 'video',
      quality: 'low',
      code: isolationCode,
      videoConfig: { frameRate: 10, timeout: 180000 },
      customApiConfig: CUSTOM_API,
      providerConfig: CUSTOM_API,
    })
    const job = await waitForJob(jobId)
    if (job.status !== 'completed') throw new Error(`isolation probe failed inside sandbox: ${JSON.stringify(job).slice(0, 3000)}`)
    const video = await saveUrl(job.video_url, 'workflow-isolation.mp4')
    assertVideo(video.target, { audio: false })
    record('hostile isolation', true, `${jobId} host paths/env/network/read-only input denied`, video.target)
  }

  // 7. Studio Matplotlib render: real sandboxed Python, real PNG attachment.
  {
    const result = await studioCase('studio-matplotlib', 'matplotlib', 'Render a simple plot', {
      runStatus: 'completed',
      renderStatus: 'completed',
      media: 'image',
    })
    record('studio matplotlib render', true, result.detail, result.evidence)
  }

  // 8. Studio Manim render: real queue + bubblewrap + video.
  {
    const result = await studioCase('studio-manim', 'manim', 'Render a dot animation', {
      runStatus: 'completed',
      renderStatus: 'completed',
      media: 'video',
    })
    record('studio manim render', true, result.detail, result.evidence)
  }

  // 9. Hostile symlink export must be rejected by artifact publication, not delivered.
  {
    const result = await studioCase('studio-hostile-symlink', 'matplotlib', 'hostile symlink export', {
      runStatus: 'any',
      renderStatus: 'failed',
      media: 'failed',
    })
    record('hostile symlink export rejected', true, result.detail, result.evidence)
  }

  fs.writeFileSync(path.join(EVIDENCE, 'http-e2e-results.json'), JSON.stringify({
    base: BASE,
    results,
    failures,
    finishedAt: new Date().toISOString(),
  }, null, 2))
  if (failures > 0) {
    log(`RESULT FAIL ${failures} case(s)`)
    process.exit(1)
  }
  log(`RESULT PASS ${results.length} case(s)`)
}

main().catch(error => {
  console.error(`FATAL ${error instanceof Error ? error.stack : String(error)}`)
  try {
    fs.mkdirSync(EVIDENCE, { recursive: true })
    fs.writeFileSync(path.join(EVIDENCE, 'http-e2e-results.json'), JSON.stringify({
      base: BASE, results, failures: failures + 1, fatal: error instanceof Error ? error.message : String(error),
    }, null, 2))
  } catch { /* best effort */ }
  process.exit(1)
})
