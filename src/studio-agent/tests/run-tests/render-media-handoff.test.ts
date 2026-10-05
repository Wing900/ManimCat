import assert from 'node:assert/strict'
import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { PassThrough, Writable } from 'node:stream'
import type { Response } from 'express'
import { createStudioRender } from '../../domain/factories'
import { handleStudioRenderMediaRequest } from '../../../routes/helpers/studio-agent-render-media-handler'
import { run } from './factories'

class FakeResponse extends PassThrough {
  statusCode = 200
  headers: Record<string, string> = {}
  payload: unknown = null

  setHeader(name: string, value: string): this {
    this.headers[name] = value
    return this
  }

  status(code: number): this {
    this.statusCode = code
    return this
  }

  json(body: unknown): this {
    this.payload = body
    return this
  }
}

async function createMediaRoot(): Promise<string> {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'studio-render-media-'))
  await fsp.mkdir(path.join(root, 'public', 'videos'), { recursive: true })
  return root
}

function renderFixture(overrides: { sessionId?: string; sceneId?: string; jobId?: string } = {}) {
  const render = createStudioRender({
    ownerId: 'owner-1',
    sessionId: overrides.sessionId ?? 'sess_1',
    sceneId: overrides.sceneId ?? 'scene_1',
    kind: 'manim',
    title: 'render',
    concept: 'circle',
    outputMode: 'video'
  })
  render.jobId = overrides.jobId ?? 'job-1'
  return render
}

export async function runRenderMediaHandoffTests(): Promise<void> {
  await run('a delivered video is handed to the browser and then deleted from the server', async () => {
    const root = await createMediaRoot()
    const bytes = Buffer.from('fake-mp4-bytes')
    const file = path.join(root, 'public', 'videos', 'job-1.mp4')
    await fsp.writeFile(file, bytes)

    const res = new FakeResponse()
    const chunks: Buffer[] = []
    res.on('data', (chunk: Buffer) => chunks.push(chunk))

    const render = renderFixture()
    await handleStudioRenderMediaRequest({
      res: res as unknown as Response,
      ownerId: 'owner-1',
      sessionId: 'sess_1',
      sceneId: 'scene_1',
      renderId: render.id,
      getRender: async () => render,
      publicDirectory: path.join(root, 'public'),
      removeAfterDelivery: true
    })

    assert.equal(res.headers['Content-Type'], 'video/mp4')
    assert.equal(Buffer.concat(chunks).toString(), 'fake-mp4-bytes')
    assert.equal(
      await fsp.stat(file).then(
        () => true,
        () => false
      ),
      false,
      'the file must be gone once the browser has it'
    )
  })

  await run('a dropped connection leaves the file in place', async () => {
    const root = await createMediaRoot()
    const file = path.join(root, 'public', 'videos', 'job-1.mp4')
    await fsp.writeFile(file, Buffer.alloc(1024, 1))

    // A destination that fails on write: the client never received a usable copy.
    const failing = new Writable({
      write(_chunk, _encoding, callback) {
        callback(new Error('connection lost'))
      }
    })
    const res = Object.assign(failing, { setHeader: () => failing }) as unknown as Response

    const render = renderFixture()
    await handleStudioRenderMediaRequest({
      res,
      ownerId: 'owner-1',
      sessionId: 'sess_1',
      sceneId: 'scene_1',
      renderId: render.id,
      getRender: async () => render,
      publicDirectory: path.join(root, 'public'),
      removeAfterDelivery: true
    })

    assert.equal(await fsp.stat(file).then(() => true, () => false), true)
  })

  await run('an unknowable Render answers with one non-enumerating 404', async () => {
    const root = await createMediaRoot()
    const render = renderFixture()

    const cases: Array<{ renderId: string; getRender: () => Promise<ReturnType<typeof renderFixture> | null> }> = [
      { renderId: render.id, getRender: async () => null },
      { renderId: render.id, getRender: async () => renderFixture({ sessionId: 'sess_other' }) },
      { renderId: render.id, getRender: async () => renderFixture({ sceneId: 'scene_other' }) },
      { renderId: '../../etc/passwd', getRender: async () => render }
    ]

    for (const testCase of cases) {
      const res = new FakeResponse()
      await handleStudioRenderMediaRequest({
        res: res as unknown as Response,
        ownerId: 'owner-1',
        sessionId: 'sess_1',
        sceneId: 'scene_1',
        renderId: testCase.renderId,
        getRender: testCase.getRender as never,
        publicDirectory: path.join(root, 'public')
      })

      assert.equal(res.statusCode, 404)
      assert.equal((res.payload as { error?: { code?: string } })?.error?.code, 'NOT_FOUND')
    }
  })

  await run('a Render whose media is already gone is a 404, not a re-render', async () => {
    const root = await createMediaRoot()
    const render = renderFixture()

    const res = new FakeResponse()
    await handleStudioRenderMediaRequest({
      res: res as unknown as Response,
      ownerId: 'owner-1',
      sessionId: 'sess_1',
      sceneId: 'scene_1',
      renderId: render.id,
      getRender: async () => render,
      publicDirectory: path.join(root, 'public')
    })

    assert.equal(res.statusCode, 404)
  })

  await run('a job id that is not a filename stem is refused', async () => {
    const root = await createMediaRoot()
    const outside = path.join(root, 'secret.mp4')
    await fsp.writeFile(outside, Buffer.from('secret'))
    const render = renderFixture({ jobId: '../secret' })

    const res = new FakeResponse()
    await handleStudioRenderMediaRequest({
      res: res as unknown as Response,
      ownerId: 'owner-1',
      sessionId: 'sess_1',
      sceneId: 'scene_1',
      renderId: render.id,
      getRender: async () => render,
      publicDirectory: path.join(root, 'public')
    })

    assert.equal(res.statusCode, 404)
    assert.equal(await fsp.stat(outside).then(() => true, () => false), true)
  })

  await run('delivery keeps the file with deletion disabled or omitted', async () => {
    const root = await createMediaRoot()
    const file = path.join(root, 'public', 'videos', 'job-1.mp4')
    await fsp.writeFile(file, Buffer.from('video bytes'))
    const render = renderFixture()
    for (const removeAfterDelivery of [false, undefined]) {
      const res = new FakeResponse()
      res.resume()
      await handleStudioRenderMediaRequest({
        res: res as unknown as Response, ownerId: 'owner-1', sessionId: 'sess_1',
        sceneId: 'scene_1', renderId: render.id, getRender: async () => render,
        publicDirectory: path.join(root, 'public'), removeAfterDelivery,
      })
      assert.equal(res.statusCode, 200)
      assert.equal(await fsp.readFile(file, 'utf8'), 'video bytes')
    }
  })

  const root = await createMediaRoot()
  const secret = path.join(root, 'secret.mp4')
  await fsp.writeFile(secret, Buffer.from('private video'))
  try {
    await fsp.symlink(secret, path.join(root, 'public', 'videos', 'job-1.mp4'), 'file')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EPERM') throw error
    console.log('SKIP outside-media symlink: this environment cannot create file symlinks')
    return
  }
  await run('a media symlink cannot deliver or delete a file outside the video directory', async () => {
    const render = renderFixture()
    const res = new FakeResponse()
    await handleStudioRenderMediaRequest({
      res: res as unknown as Response, ownerId: 'owner-1', sessionId: 'sess_1', sceneId: 'scene_1',
      renderId: render.id, getRender: async () => render, publicDirectory: path.join(root, 'public'),
      removeAfterDelivery: true,
    })
    assert.equal(res.statusCode, 404)
    assert.equal(await fsp.readFile(secret, 'utf8'), 'private video')
  })
}
