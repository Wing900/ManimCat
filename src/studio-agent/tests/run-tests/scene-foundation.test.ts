import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import {
  createInMemoryStudioPersistence,
  createLocalStudioWorkspaceProvider,
  createStudioRuntimeService,
  createStudioSceneService,
  createStudioSceneId,
  createStudioSession,
  STUDIO_SCENE_SOURCE_TEMPLATE,
  StudioSceneOrderRejectedError,
  type StudioCreateSceneOutcome,
  type StudioPersistence,
  type StudioScene,
  type StudioSceneService,
  type StudioSession,
} from '../../index'
import { toPublicStudioScene, toPublicStudioSnapshot } from '../../http/public-dto'
import { createWorkspace, run } from './factories'

/** Scene ids are Python module stems: `scene_` plus lowercase hex, or any plain identifier. */
const PYTHON_IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/

async function createTestSession(options?: { ownerId?: string; directory?: string }): Promise<{
  persistence: StudioPersistence
  session: StudioSession
  directory: string
}> {
  const persistence = createInMemoryStudioPersistence()
  const directory = options?.directory ?? (await createWorkspace())
  const session = createStudioSession({
    ownerId: options?.ownerId ?? 'owner-a',
    projectId: 'project-1',
    agentType: 'builder',
    title: 'Scene foundation',
    directory,
  })
  await persistence.sessionStore.create(session)
  return { persistence, session, directory }
}

function createSceneService(
  persistence: StudioPersistence,
  options?: { generateSceneId?: () => string }
): StudioSceneService {
  return createStudioSceneService({
    persistence,
    workspaceProvider: createLocalStudioWorkspaceProvider(),
    generateSceneId: options?.generateSceneId,
  })
}

function assertCreated(outcome: StudioCreateSceneOutcome): StudioScene {
  assert.equal(outcome.status, 'created')
  if (outcome.status !== 'created') {
    throw new Error('expected a created scene')
  }
  return outcome.scene
}

async function createScenes(service: StudioSceneService, session: StudioSession, count: number): Promise<StudioScene[]> {
  const scenes: StudioScene[] = []
  for (let index = 0; index < count; index += 1) {
    scenes.push(assertCreated(await service.createScene({ ownerId: session.ownerId, sessionId: session.id })))
  }
  return scenes
}

export async function runSceneFoundationTests(): Promise<void> {
  await run('creating a scene appends it to its owning session', async () => {
    const { persistence, session } = await createTestSession()
    const service = createSceneService(persistence)

    const [first, second] = await createScenes(service, session, 2)

    assert.equal(first.position, 0)
    assert.equal(second.position, 1)
    assert.equal(first.sessionId, session.id)
    assert.equal(first.ownerId, session.ownerId)
    assert.deepEqual(
      (await service.listScenes(session.ownerId, session.id)).map((scene) => scene.id),
      [first.id, second.id]
    )
  })

  await run('scene ids are python import-safe and stable per scene', async () => {
    const { persistence, session } = await createTestSession()
    const service = createSceneService(persistence)

    const scenes = await createScenes(service, session, 3)

    for (const scene of scenes) {
      assert.match(scene.id, PYTHON_IDENTIFIER)
      assert.match(scene.id, /^scene_[0-9a-f]+$/)
    }
    assert.equal(new Set(scenes.map((scene) => scene.id)).size, scenes.length)
    assert.match(createStudioSceneId(), PYTHON_IDENTIFIER)
  })

  await run('the scene source stays beneath the session directory', async () => {
    const { persistence, session, directory } = await createTestSession()
    const service = createSceneService(persistence)

    const scene = assertCreated(await service.createScene({ ownerId: session.ownerId, sessionId: session.id }))

    assert.equal(
      path.relative(path.resolve(directory), scene.sourcePath),
      path.join('scenes', `${scene.id}.py`)
    )
    assert.equal(fs.readFileSync(scene.sourcePath, 'utf8'), STUDIO_SCENE_SOURCE_TEMPLATE)
    // The file itself carries no positional or semantic name; only the path does.
    assert.equal(STUDIO_SCENE_SOURCE_TEMPLATE.includes(scene.id), false)
  })

  await run('a brand-new session creates its first scene without a scenes directory', async () => {
    const { persistence, session, directory } = await createTestSession()
    const scenesDirectory = path.join(directory, 'scenes')
    assert.equal(fs.existsSync(scenesDirectory), false, 'the session starts without a scenes directory')

    const service = createSceneService(persistence)
    const scene = assertCreated(await service.createScene({ ownerId: session.ownerId, sessionId: session.id }))

    // Regression: resolving the path against the absent `scenes` directory rejected the first
    // Scene, so a fresh Session could never start.
    assert.equal(fs.existsSync(scenesDirectory), true)
    assert.equal(fs.readFileSync(scene.sourcePath, 'utf8'), STUDIO_SCENE_SOURCE_TEMPLATE)
    assert.equal(scene.position, 0)
  })

  await run('a scenes link that escapes the session directory is rejected', async () => {
    const root = await createWorkspace()
    const outside = await createWorkspace()
    const { persistence, session } = await createTestSession({ directory: root })
    fs.symlinkSync(outside, path.join(root, 'scenes'), process.platform === 'win32' ? 'junction' : 'dir')

    const service = createSceneService(persistence)
    const outcome = await service.createScene({ ownerId: session.ownerId, sessionId: session.id })

    assert.equal(outcome.status, 'source_rejected')
    assert.deepEqual(fs.readdirSync(outside), [])
    assert.deepEqual(await service.listScenes(session.ownerId, session.id), [])
  })

  await run('an occupied scene source fails closed without overwrite', async () => {
    const { persistence, session } = await createTestSession()
    const sceneId = 'scene_occupied0000000000000000000001'
    const scenesDirectory = path.join(session.directory, 'scenes')
    fs.mkdirSync(scenesDirectory, { recursive: true })
    const occupied = path.join(scenesDirectory, `${sceneId}.py`)
    fs.writeFileSync(occupied, 'ORIGINAL = 1\n', 'utf8')

    const service = createSceneService(persistence, { generateSceneId: () => sceneId })
    const outcome = await service.createScene({ ownerId: session.ownerId, sessionId: session.id })

    assert.equal(outcome.status, 'source_conflict')
    assert.equal(fs.readFileSync(occupied, 'utf8'), 'ORIGINAL = 1\n')
    assert.deepEqual(await service.listScenes(session.ownerId, session.id), [])
  })

  await run('a filesystem failure leaves no persisted scene', async () => {
    const root = await createWorkspace()
    // A session directory that is a file makes `scenes/` impossible to create.
    const blockedDirectory = path.join(root, 'session-directory-is-a-file')
    fs.writeFileSync(blockedDirectory, 'not a directory\n', 'utf8')
    const { persistence, session } = await createTestSession({ directory: blockedDirectory })
    const service = createSceneService(persistence)

    const outcome = await service.createScene({ ownerId: session.ownerId, sessionId: session.id })

    assert.equal(outcome.status, 'source_rejected')
    assert.equal(fs.readFileSync(blockedDirectory, 'utf8'), 'not a directory\n')
    assert.deepEqual(await service.listScenes(session.ownerId, session.id), [])
  })

  await run('persistence failure compensates only the verified new source file', async () => {
    const { persistence, session } = await createTestSession()
    const scenesDirectory = path.join(session.directory, 'scenes')
    fs.mkdirSync(scenesDirectory, { recursive: true })
    const sibling = path.join(scenesDirectory, 'keep-me.py')
    fs.writeFileSync(sibling, 'KEEP = 1\n', 'utf8')

    const failingPersistence: StudioPersistence = {
      ...persistence,
      sceneStore: {
        create: (scene) => persistence.sceneStore.create(scene),
        append: async () => {
          throw new Error('scene store unavailable')
        },
        getById: (ownerId, sceneId) => persistence.sceneStore.getById(ownerId, sceneId),
        listBySessionId: (ownerId, sessionId) => persistence.sceneStore.listBySessionId(ownerId, sessionId),
        replaceOrder: (ownerId, sessionId, sceneIds) =>
          persistence.sceneStore.replaceOrder(ownerId, sessionId, sceneIds),
      },
    }
    const service = createSceneService(failingPersistence)

    const outcome = await service.createScene({ ownerId: session.ownerId, sessionId: session.id })

    assert.equal(outcome.status, 'persistence_failed')
    assert.deepEqual(fs.readdirSync(scenesDirectory), ['keep-me.py'])
    assert.equal(fs.readFileSync(sibling, 'utf8'), 'KEEP = 1\n')
    assert.deepEqual(await service.listScenes(session.ownerId, session.id), [])
  })

  await run('cross-owner scene access is hidden', async () => {
    const { persistence, session } = await createTestSession()
    const service = createSceneService(persistence)
    const scene = assertCreated(await service.createScene({ ownerId: session.ownerId, sessionId: session.id }))

    assert.equal((await service.createScene({ ownerId: 'owner-b', sessionId: session.id })).status, 'session_not_found')
    assert.equal(await service.getScene('owner-b', scene.id), null)
    assert.deepEqual(await service.listScenes('owner-b', session.id), [])
    assert.equal(await service.getScene('owner-b', 'scene_missing00000000000000000000001'), null)
    assert.ok(await service.getScene(session.ownerId, scene.id))
  })

  await run('listing is deterministically ordered by position', async () => {
    const { persistence, session } = await createTestSession()
    const service = createSceneService(persistence)
    const [first, second, third] = await createScenes(service, session, 3)

    const reordered = await service.reorderScenes({
      ownerId: session.ownerId,
      sessionId: session.id,
      sceneIds: [third.id, first.id, second.id],
    })

    assert.equal(reordered.status, 'reordered')
    const listed = await service.listScenes(session.ownerId, session.id)
    assert.deepEqual(
      listed.map((scene) => scene.id),
      [third.id, first.id, second.id]
    )
    assert.deepEqual(
      listed.map((scene) => scene.position),
      [0, 1, 2]
    )
  })

  await run('reordering produces contiguous positions', async () => {
    const { persistence, session } = await createTestSession()
    const service = createSceneService(persistence)
    const scenes = await createScenes(service, session, 3)

    assert.deepEqual(
      scenes.map((scene) => scene.position),
      [0, 1, 2]
    )

    const reordered = await service.reorderScenes({
      ownerId: session.ownerId,
      sessionId: session.id,
      sceneIds: [scenes[1].id, scenes[2].id, scenes[0].id],
    })

    assert.equal(reordered.status, 'reordered')
    if (reordered.status !== 'reordered') {
      throw new Error('expected a reordered scene list')
    }
    assert.deepEqual(
      reordered.scenes.map((scene) => scene.position),
      [0, 1, 2]
    )
    assert.equal(new Set(reordered.scenes.map((scene) => scene.position)).size, 3)
    assert.equal(reordered.scenes.length, 3)
  })

  await run('reordering leaves ids and source paths unchanged', async () => {
    const { persistence, session } = await createTestSession()
    const service = createSceneService(persistence)
    const scenes = await createScenes(service, session, 3)
    const sourcePathsBySceneId = new Map(scenes.map((scene) => [scene.id, scene.sourcePath]))

    await service.reorderScenes({
      ownerId: session.ownerId,
      sessionId: session.id,
      sceneIds: [scenes[2].id, scenes[0].id, scenes[1].id],
    })

    const listed = await service.listScenes(session.ownerId, session.id)
    assert.deepEqual(
      listed.map((scene) => scene.id).sort(),
      scenes.map((scene) => scene.id).sort()
    )
    for (const scene of listed) {
      assert.equal(scene.sourcePath, sourcePathsBySceneId.get(scene.id))
      assert.equal(fs.existsSync(scene.sourcePath), true)
    }
  })

  await run('order submissions that do not match the session scenes are rejected', async () => {
    const { persistence, session } = await createTestSession()
    const service = createSceneService(persistence)
    const [first, second] = await createScenes(service, session, 2)

    const otherSession = createStudioSession({
      ownerId: session.ownerId,
      projectId: 'project-1',
      agentType: 'builder',
      title: 'Sibling session',
      directory: await createWorkspace(),
    })
    await persistence.sessionStore.create(otherSession)
    const foreignSessionScene = assertCreated(
      await service.createScene({ ownerId: otherSession.ownerId, sessionId: otherSession.id })
    )

    const foreignOwnerSession = createStudioSession({
      ownerId: 'owner-b',
      projectId: 'project-1',
      agentType: 'builder',
      title: 'Foreign owner session',
      directory: await createWorkspace(),
    })
    await persistence.sessionStore.create(foreignOwnerSession)
    const foreignOwnerScene = assertCreated(
      await service.createScene({ ownerId: foreignOwnerSession.ownerId, sessionId: foreignOwnerSession.id })
    )

    const rejections: Array<{ sceneIds: string[]; reason: string }> = [
      { sceneIds: [first.id, first.id], reason: 'duplicate_scene' },
      { sceneIds: [], reason: 'empty_order' },
      { sceneIds: [first.id, 'scene_unknown0000000000000000000001'], reason: 'missing_scene' },
      { sceneIds: [first.id], reason: 'incomplete_set' },
      { sceneIds: [first.id, foreignSessionScene.id], reason: 'foreign_scene' },
      { sceneIds: [first.id, foreignOwnerScene.id], reason: 'missing_scene' },
    ]

    for (const rejection of rejections) {
      const outcome = await service.reorderScenes({
        ownerId: session.ownerId,
        sessionId: session.id,
        sceneIds: rejection.sceneIds,
      })
      assert.equal(outcome.status, 'invalid_order')
      if (outcome.status !== 'invalid_order') {
        throw new Error('expected an invalid order outcome')
      }
      assert.equal(outcome.reason, rejection.reason)
    }

    // A rejected order never renumbers the session.
    assert.deepEqual(
      (await service.listScenes(session.ownerId, session.id)).map((scene) => scene.position),
      [0, 1]
    )

    // The store keeps the same vocabulary when a caller reaches it directly.
    await assert.rejects(
      () => persistence.sceneStore.replaceOrder(session.ownerId, session.id, []),
      (error: unknown) =>
        error instanceof StudioSceneOrderRejectedError && error.reason === 'empty_order'
    )
    await assert.rejects(
      () => persistence.sceneStore.replaceOrder(session.ownerId, session.id, [second.id]),
      (error: unknown) => error instanceof StudioSceneOrderRejectedError && error.reason === 'incomplete_set'
    )
  })

  await run('concurrent scene creation cannot persist duplicate positions', async () => {
    const { persistence, session } = await createTestSession()
    const service = createSceneService(persistence)

    const outcomes = await Promise.all(
      Array.from({ length: 6 }, () => service.createScene({ ownerId: session.ownerId, sessionId: session.id }))
    )
    for (const outcome of outcomes) {
      assert.equal(outcome.status, 'created')
    }

    const listed = await service.listScenes(session.ownerId, session.id)
    assert.equal(listed.length, 6)
    assert.deepEqual(
      listed.map((scene) => scene.position),
      [0, 1, 2, 3, 4, 5]
    )
    assert.equal(new Set(listed.map((scene) => scene.position)).size, 6)
  })

  await run('the scene migration keeps rows tied to their session', async () => {
    const migration = fs.readFileSync(
      path.join(process.cwd(), 'src', 'database', 'migrations', '010_create_studio_scenes.sql'),
      'utf8'
    )

    assert.match(migration, /create table if not exists studio_scenes/i)
    assert.match(migration, /session_id text not null references studio_sessions\(id\) on delete cascade/i)
    assert.match(migration, /unique \(session_id, position\)/i)
    assert.match(migration, /check \(position >= 0\)/i)
    assert.match(migration, /create index if not exists idx_studio_scenes_owner_session_position/i)
    assert.match(migration, /create or replace function studio_scene_append/i)
    assert.match(migration, /create or replace function studio_scene_replace_order/i)
    assert.match(migration, /pg_advisory_xact_lock/i)
  })

  await run('public scene and snapshot DTOs omit owner and source path', async () => {
    const { persistence, session } = await createTestSession()
    const service = createSceneService(persistence)
    const scene = assertCreated(await service.createScene({ ownerId: session.ownerId, sessionId: session.id }))

    const publicScene = toPublicStudioScene(scene)
    assert.equal('ownerId' in publicScene, false)
    assert.equal('sourcePath' in publicScene, false)
    assert.equal(publicScene.id, scene.id)
    assert.equal(publicScene.position, scene.position)

    const runtime = createStudioRuntimeService({
      persistence,
      workspaceProvider: createLocalStudioWorkspaceProvider(),
    })
    const snapshot = await runtime.getSessionSnapshot(session.ownerId, session.id)
    assert.ok(snapshot)
    const publicSnapshot = toPublicStudioSnapshot(snapshot)

    assert.equal(publicSnapshot.scenes.length, 1)
    assert.equal('ownerId' in publicSnapshot.scenes[0], false)
    assert.equal('sourcePath' in publicSnapshot.scenes[0], false)
    assert.equal(JSON.stringify(publicSnapshot).includes(session.ownerId), false)
    assert.equal(JSON.stringify(publicSnapshot).includes(session.directory), false)
  })

  await run('a legacy session snapshot returns an empty scene list', async () => {
    const { persistence, session } = await createTestSession()
    const runtime = createStudioRuntimeService({
      persistence,
      workspaceProvider: createLocalStudioWorkspaceProvider(),
    })

    const snapshot = await runtime.getSessionSnapshot(session.ownerId, session.id)

    assert.ok(snapshot)
    assert.deepEqual(snapshot.scenes, [])
    assert.equal((await runtime.getSessionSnapshot(session.ownerId, 'sess_missing'))?.scenes, undefined)
  })

  await run('existing snapshot fields stay present beside scenes', async () => {
    const { persistence, session } = await createTestSession()
    const runtime = createStudioRuntimeService({
      persistence,
      workspaceProvider: createLocalStudioWorkspaceProvider(),
    })
    const scene = assertCreated(
      await runtime.createScene({ ownerId: session.ownerId, sessionId: session.id })
    )

    const snapshot = await runtime.getSessionSnapshot(session.ownerId, session.id)

    assert.ok(snapshot)
    assert.equal(snapshot.session.id, session.id)
    assert.equal(snapshot.session.ownerId, session.ownerId)
    assert.deepEqual(snapshot.messages, [])
    assert.deepEqual(snapshot.runs, [])
    assert.deepEqual(snapshot.renders, [])
    assert.deepEqual(
      snapshot.scenes.map((entry) => entry.id),
      [scene.id]
    )
    const publicSnapshot = toPublicStudioSnapshot(snapshot)
    assert.deepEqual(
      Object.keys(publicSnapshot).sort(),
      ['messages', 'renders', 'runs', 'scenes', 'session']
    )
    assert.equal('directory' in publicSnapshot.session, false)
  })
}
