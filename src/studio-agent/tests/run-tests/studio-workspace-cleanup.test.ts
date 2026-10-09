import assert from 'node:assert/strict'
import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import {
  cleanupExpiredStudioWorkspaces,
  readStudioWorkspaceLastActivity,
  STUDIO_WORKSPACE_ACTIVITY_FILE,
} from '../../workspace/studio-workspace-cleanup'
import { run } from './factories'

async function createRoot(): Promise<string> {
  return fsp.mkdtemp(path.join(os.tmpdir(), 'studio-workspace-cleanup-'))
}

async function exists(target: string): Promise<boolean> {
  return fsp.stat(target).then(
    () => true,
    () => false
  )
}

const HOUR = 60 * 60 * 1000

export async function runStudioWorkspaceCleanupTests(): Promise<void> {
  await run('a quiet Session workspace is removed and a recently used one is kept', async () => {
    const root = await createRoot()
    const kindDirectory = path.join(root, 'manim-studio')
    const expired = path.join(kindDirectory, 'sess_expired')
    const fresh = path.join(kindDirectory, 'sess_fresh')

    await fsp.mkdir(path.join(expired, 'scenes'), { recursive: true })
    await fsp.writeFile(path.join(expired, 'scenes', 'scene_1.py'), 'X = 1\n', 'utf8')
    await fsp.mkdir(path.join(fresh, 'scenes'), { recursive: true })

    const now = Date.now()
    const marker = STUDIO_WORKSPACE_ACTIVITY_FILE
    await fsp.writeFile(path.join(expired, marker), 'x', 'utf8')
    await fsp.utimes(path.join(expired, marker), new Date(now - 10 * HOUR), new Date(now - 10 * HOUR))
    await fsp.writeFile(path.join(fresh, marker), 'x', 'utf8')
    await fsp.utimes(path.join(fresh, marker), new Date(now - 1 * HOUR), new Date(now - 1 * HOUR))

    const { removed } = await cleanupExpiredStudioWorkspaces({
      rootDirectory: root,
      cutoffTime: now - 5 * HOUR
    })

    assert.deepEqual(removed, [expired])
    assert.equal(await exists(expired), false)
    assert.equal(await exists(fresh), true)
    assert.equal(await fsp.readFile(path.join(fresh, marker), 'utf8'), 'x')
  })

  await run('a workspace written before the marker existed falls back to its directory mtime', async () => {
    const root = await createRoot()
    const sessionDirectory = path.join(root, 'manim-studio', 'sess_legacy')
    await fsp.mkdir(sessionDirectory, { recursive: true })

    const now = Date.now()
    await fsp.utimes(sessionDirectory, new Date(now - 9 * HOUR), new Date(now - 9 * HOUR))

    assert.equal(await readStudioWorkspaceLastActivity(sessionDirectory) > 0, true)

    const { removed } = await cleanupExpiredStudioWorkspaces({
      rootDirectory: root,
      cutoffTime: now - 5 * HOUR
    })

    assert.deepEqual(removed, [sessionDirectory])
  })

  await run('the shared engine caches and hidden entries are left alone', async () => {
    const root = await createRoot()
    const kindDirectory = path.join(root, 'manim-studio')
    const sessionDirectory = path.join(kindDirectory, 'sess_kept')
    const hiddenKind = path.join(root, '.studio')
    const hiddenSession = path.join(kindDirectory, '.trash')

    await fsp.mkdir(sessionDirectory, { recursive: true })
    await fsp.mkdir(hiddenKind, { recursive: true })
    await fsp.mkdir(hiddenSession, { recursive: true })

    const now = Date.now()
    for (const target of [sessionDirectory, hiddenKind, hiddenSession]) {
      await fsp.utimes(target, new Date(now - 20 * HOUR), new Date(now - 20 * HOUR))
    }
    await fsp.writeFile(path.join(sessionDirectory, STUDIO_WORKSPACE_ACTIVITY_FILE), 'x', 'utf8')
    await fsp.utimes(
      path.join(sessionDirectory, STUDIO_WORKSPACE_ACTIVITY_FILE),
      new Date(now - 20 * HOUR),
      new Date(now - 20 * HOUR)
    )

    const { removed } = await cleanupExpiredStudioWorkspaces({
      rootDirectory: root,
      cutoffTime: now - 5 * HOUR
    })

    assert.deepEqual(removed, [sessionDirectory])
    assert.equal(await exists(hiddenKind), true)
    assert.equal(await exists(hiddenSession), true)
  })

  await run('a missing workspace root is not an error', async () => {
    const { removed } = await cleanupExpiredStudioWorkspaces({
      rootDirectory: path.join(os.tmpdir(), 'studio-workspace-cleanup-absent-root'),
      cutoffTime: Date.now()
    })

    assert.deepEqual(removed, [])
  })
}
