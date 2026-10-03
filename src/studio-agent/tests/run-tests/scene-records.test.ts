import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import {
  createInMemoryStudioPersistence,
  createLocalStudioWorkspaceProvider,
  createStudioAssistantMessage,
  createStudioRender,
  createStudioRun,
  createStudioRuntimeService,
  createStudioSession,
  createStudioUserMessage,
  type StudioCreateSceneOutcome,
  type StudioPersistence,
  type StudioRender,
  type StudioRun,
  type StudioScene,
  type StudioSession,
  type StudioUserMessage,
} from '../../index'
import { toPublicStudioSceneSnapshot, toPublicStudioSnapshot } from '../../http/public-dto'
import { createWorkspace, run } from './factories'

const OWNER = 'owner-a'
const FOREIGN_OWNER = 'owner-b'

function readStudioSource(...segments: string[]): string {
  return fs.readFileSync(path.join(process.cwd(), ...segments), 'utf8')
}

/** Every `async <name>(` body of a Supabase adapter file, sliced at the closing `    },`. */
function extractMethodBodies(source: string, signature: string): string[] {
  const bodies: string[] = []
  let index = source.indexOf(signature)
  while (index >= 0) {
    const end = source.indexOf('\n    },\n', index)
    bodies.push(source.slice(index, end < 0 ? source.length : end))
    index = source.indexOf(signature, index + signature.length)
  }
  return bodies
}

function countMatches(source: string, pattern: RegExp): number {
  return source.match(pattern)?.length ?? 0
}

function assertCreatedScene(outcome: StudioCreateSceneOutcome): StudioScene {
  assert.equal(outcome.status, 'created')
  if (outcome.status !== 'created') {
    throw new Error('expected a created scene')
  }
  return outcome.scene
}

interface SceneFixture {
  persistence: StudioPersistence
  runtime: ReturnType<typeof createStudioRuntimeService>
  session: StudioSession
  scenes: StudioScene[]
  otherSession: StudioSession
  otherSessionScene: StudioScene
}

async function createSceneFixture(): Promise<SceneFixture> {
  const persistence = createInMemoryStudioPersistence()
  const runtime = createStudioRuntimeService({
    persistence,
    workspaceProvider: createLocalStudioWorkspaceProvider(),
  })
  const session = createStudioSession({
    ownerId: OWNER,
    projectId: 'project-1',
    agentType: 'builder',
    title: 'Scene records',
    directory: await createWorkspace(),
  })
  await persistence.sessionStore.create(session)

  const scenes: StudioScene[] = []
  for (let index = 0; index < 2; index += 1) {
    scenes.push(assertCreatedScene(await runtime.createScene({ ownerId: OWNER, sessionId: session.id })))
  }

  const otherSession = createStudioSession({
    ownerId: OWNER,
    projectId: 'project-1',
    agentType: 'builder',
    title: 'Sibling session',
    directory: await createWorkspace(),
  })
  await persistence.sessionStore.create(otherSession)
  const otherSessionScene = assertCreatedScene(
    await runtime.createScene({ ownerId: OWNER, sessionId: otherSession.id })
  )

  return { persistence, runtime, session, scenes, otherSession, otherSessionScene }
}

interface SeededRecords {
  message: StudioUserMessage
  run: StudioRun
  render: StudioRender
}

/** Seeds one message, one Run and one render at an explicit creation time. */
async function seedRecords(input: {
  persistence: StudioPersistence
  session: StudioSession
  sceneId?: string
  key: string
  createdAt: string
}): Promise<SeededRecords> {
  const message: StudioUserMessage = {
    ...createStudioUserMessage({ sessionId: input.session.id, sceneId: input.sceneId, text: `text-${input.key}` }),
    id: `msg_${input.key}`,
    createdAt: input.createdAt,
    updatedAt: input.createdAt,
  }
  const run: StudioRun = {
    ...createStudioRun({
      ownerId: input.session.ownerId,
      sessionId: input.session.id,
      sceneId: input.sceneId,
      inputText: `text-${input.key}`,
      activeAgent: 'builder',
    }),
    id: `run_${input.key}`,
    createdAt: input.createdAt,
    completedAt: input.createdAt,
  }
  const render: StudioRender = {
    ...createStudioRender({
      ownerId: input.session.ownerId,
      sessionId: input.session.id,
      sceneId: input.sceneId,
      kind: 'manim',
      title: `title-${input.key}`,
      concept: `concept-${input.key}`,
      outputMode: 'video',
    }),
    id: `render_${input.key}`,
    createdAt: input.createdAt,
    updatedAt: input.createdAt,
  }

  await input.persistence.messageStore.createUserMessage(message)
  await input.persistence.runStore.create(run)
  await input.persistence.renderStore.create(render)

  return { message, run, render }
}

export async function runSceneRecordTests(): Promise<void> {
  await run('factories preserve an explicit scene scope', async () => {
    const message = createStudioUserMessage({ sessionId: 'sess_1', sceneId: 'scene_a', text: 'hi' })
    const assistant = createStudioAssistantMessage({
      sessionId: 'sess_1',
      sceneId: 'scene_a',
      agent: 'builder',
    })
    const run = createStudioRun({
      ownerId: OWNER,
      sessionId: 'sess_1',
      sceneId: 'scene_a',
      inputText: 'hi',
      activeAgent: 'builder',
    })
    const render = createStudioRender({
      ownerId: OWNER,
      sessionId: 'sess_1',
      sceneId: 'scene_a',
      kind: 'manim',
      title: 'title',
      concept: 'concept',
      outputMode: 'video',
    })

    assert.equal(message.sceneId, 'scene_a')
    assert.equal(assistant.sceneId, 'scene_a')
    assert.equal(run.sceneId, 'scene_a')
    assert.equal(render.sceneId, 'scene_a')
    // `sessionId` stays mandatory beside the optional scope.
    assert.equal(message.sessionId, 'sess_1')
    assert.equal(run.sessionId, 'sess_1')
    assert.equal(render.sessionId, 'sess_1')
  })

  await run('legacy factory calls keep the scene scope absent', async () => {
    const message = createStudioUserMessage({ sessionId: 'sess_1', text: 'hi' })
    const assistant = createStudioAssistantMessage({ sessionId: 'sess_1', agent: 'builder' })
    // A `metadata.sceneId` is data, never an implicit scope.
    const run = createStudioRun({
      ownerId: OWNER,
      sessionId: 'sess_1',
      inputText: 'hi',
      activeAgent: 'builder',
      metadata: { sceneId: 'scene_a' },
    })
    const render = createStudioRender({
      ownerId: OWNER,
      sessionId: 'sess_1',
      kind: 'manim',
      title: 'title',
      concept: 'concept',
      outputMode: 'video',
      metadata: { sceneId: 'scene_a' },
    })

    for (const record of [message, assistant, run, render]) {
      assert.equal(Object.hasOwn(record, 'sceneId'), false)
    }
    assert.equal(run.sceneId, undefined)
    assert.equal(render.sceneId, undefined)
  })

  await run('in-memory scene queries exclude sibling scenes and legacy records', async () => {
    const { persistence, session, scenes } = await createSceneFixture()
    const [sceneA, sceneB] = scenes
    const scoped = await seedRecords({
      persistence,
      session,
      sceneId: sceneA.id,
      key: 'a',
      createdAt: '2024-01-01T00:00:00.000Z',
    })
    await seedRecords({
      persistence,
      session,
      sceneId: sceneB.id,
      key: 'b',
      createdAt: '2024-01-01T00:00:01.000Z',
    })
    await seedRecords({ persistence, session, key: 'legacy', createdAt: '2024-01-01T00:00:02.000Z' })

    assert.deepEqual(
      (await persistence.messageStore.listBySceneId(sceneA.id)).map((message) => message.id),
      [scoped.message.id]
    )
    assert.deepEqual(
      (await persistence.runStore.listBySceneId(OWNER, sceneA.id)).map((run) => run.id),
      [scoped.run.id]
    )
    assert.deepEqual(
      (await persistence.renderStore.listBySceneId(OWNER, sceneA.id)).map((render) => render.id),
      [scoped.render.id]
    )

    // A foreign owner sees nothing even when the Scene id is real.
    assert.deepEqual(await persistence.runStore.listBySceneId(FOREIGN_OWNER, sceneA.id), [])
    assert.deepEqual(await persistence.renderStore.listBySceneId(FOREIGN_OWNER, sceneA.id), [])
  })

  await run('supabase scene queries filter on scene and owner', async () => {
    const source = readStudioSource('src', 'studio-agent', 'persistence', 'supabase-studio-persistence.ts')
    const bodies = extractMethodBodies(source, 'async listBySceneId(')
    assert.equal(bodies.length, 3, 'one Scene query per message, Run and render store')

    const byTable = new Map<string, string>()
    for (const body of bodies) {
      const table = ['messages', 'runs', 'renders'].find((name) => body.includes(`.from(TABLES.${name})`))
      assert.ok(table, 'every Scene query targets a known table')
      byTable.set(table as string, body)
    }
    assert.equal(byTable.size, 3)

    for (const [table, body] of byTable) {
      assert.match(body, /\.eq\('scene_id', sceneId\)/, `${table} filters on the exact Scene`)
      assert.match(body, /\.order\('created_at', \{ ascending: true \}\)/)
      assert.match(body, /\.order\('id', \{ ascending: true \}\)/)
      assert.match(body, /\.select\('\*'\)/)
    }

    // `studio_messages` carries no owner column; the other two do and must filter on it.
    assert.doesNotMatch(byTable.get('messages') as string, /owner_id/)
    assert.match(byTable.get('runs') as string, /\.eq\('owner_id', ownerId\)/)
    assert.match(byTable.get('renders') as string, /\.eq\('owner_id', ownerId\)/)

    // Every insert writes the scope explicitly, so a missing scope can only mean `null`.
    assert.equal(countMatches(source, /scene_id: asNullable\(/g), 4)
  })

  await run('scene ordering is deterministic on creation time and id', async () => {
    const { persistence, session, scenes } = await createSceneFixture()
    const [sceneA] = scenes
    // Same timestamp, so only the id tie-break can order these rows.
    await seedRecords({ persistence, session, sceneId: sceneA.id, key: 'z', createdAt: '2024-02-02T00:00:00.000Z' })
    await seedRecords({ persistence, session, sceneId: sceneA.id, key: 'a', createdAt: '2024-02-02T00:00:00.000Z' })
    await seedRecords({ persistence, session, sceneId: sceneA.id, key: 'm', createdAt: '2024-02-01T00:00:00.000Z' })

    const expected = ['msg_m', 'msg_a', 'msg_z']
    assert.deepEqual(
      (await persistence.messageStore.listBySceneId(sceneA.id)).map((message) => message.id),
      expected
    )
    assert.deepEqual(
      (await persistence.runStore.listBySceneId(OWNER, sceneA.id)).map((run) => run.id),
      ['run_m', 'run_a', 'run_z']
    )
    assert.deepEqual(
      (await persistence.renderStore.listBySceneId(OWNER, sceneA.id)).map((render) => render.id),
      ['render_m', 'render_a', 'render_z']
    )
  })

  await run('a scene snapshot contains only that scene records', async () => {
    const { persistence, runtime, session, scenes } = await createSceneFixture()
    const [sceneA] = scenes
    const seeded = await seedRecords({
      persistence,
      session,
      sceneId: sceneA.id,
      key: 'a',
      createdAt: '2024-01-01T00:00:00.000Z',
    })
    const legacy = await seedRecords({
      persistence,
      session,
      key: 'legacy',
      createdAt: '2024-01-01T00:00:01.000Z',
    })

    const snapshot = await runtime.getSceneSnapshot(OWNER, session.id, sceneA.id)

    assert.ok(snapshot)
    assert.equal(snapshot.scene.id, sceneA.id)
    assert.deepEqual(
      snapshot.messages.map((message) => message.id),
      [seeded.message.id]
    )
    assert.deepEqual(
      snapshot.runs.map((entry) => entry.id),
      [seeded.run.id]
    )
    assert.deepEqual(
      snapshot.renders.map((entry) => entry.id),
      [seeded.render.id]
    )
    // A legacy record belongs to the Session, never to a Scene it never named.
    assert.equal(snapshot.messages.some((message) => message.id === legacy.message.id), false)
    assert.equal(snapshot.runs.some((entry) => entry.id === legacy.run.id), false)
    assert.equal(snapshot.renders.some((entry) => entry.id === legacy.render.id), false)
  })

  await run('a sibling scene never appears in the snapshot', async () => {
    const { persistence, runtime, session, scenes } = await createSceneFixture()
    const [sceneA, sceneB] = scenes
    const inA = await seedRecords({
      persistence,
      session,
      sceneId: sceneA.id,
      key: 'a',
      createdAt: '2024-01-01T00:00:00.000Z',
    })
    const inB = await seedRecords({
      persistence,
      session,
      sceneId: sceneB.id,
      key: 'b',
      createdAt: '2024-01-01T00:00:01.000Z',
    })

    const snapshot = await runtime.getSceneSnapshot(OWNER, session.id, sceneA.id)

    assert.ok(snapshot)
    const ids = [
      ...snapshot.messages.map((message) => message.id),
      ...snapshot.runs.map((entry) => entry.id),
      ...snapshot.renders.map((entry) => entry.id),
    ]
    assert.deepEqual(ids, [inA.message.id, inA.run.id, inA.render.id])
    for (const siblingId of [inB.message.id, inB.run.id, inB.render.id]) {
      assert.equal(ids.includes(siblingId), false)
    }

    // The sibling Scene keeps its own, separate view.
    const siblingSnapshot = await runtime.getSceneSnapshot(OWNER, session.id, sceneB.id)
    assert.ok(siblingSnapshot)
    assert.deepEqual(
      siblingSnapshot.messages.map((message) => message.id),
      [inB.message.id]
    )
  })

  await run('a foreign owner receives no scene snapshot', async () => {
    const { runtime, session, scenes } = await createSceneFixture()

    assert.equal(await runtime.getSceneSnapshot(FOREIGN_OWNER, session.id, scenes[0].id), null)
    assert.equal(await runtime.getSceneSnapshot(FOREIGN_OWNER, session.id, scenes[1].id), null)
  })

  await run('a scene of another session receives no snapshot', async () => {
    const { runtime, session, scenes, otherSessionScene } = await createSceneFixture()

    assert.equal(await runtime.getSceneSnapshot(OWNER, session.id, otherSessionScene.id), null)
    assert.ok(await runtime.getSceneSnapshot(OWNER, session.id, scenes[0].id))
    assert.ok(await runtime.getSceneSnapshot(OWNER, otherSessionScene.sessionId, otherSessionScene.id))
  })

  await run('the public scene snapshot strips every private field', async () => {
    const { persistence, runtime, session, scenes } = await createSceneFixture()
    const [sceneA] = scenes
    await seedRecords({
      persistence,
      session,
      sceneId: sceneA.id,
      key: 'a',
      createdAt: '2024-01-01T00:00:00.000Z',
    })

    // Unique sentinels: only a real leak can put these strings in the public body.
    const runErrorSentinel = 'internal-run-error-sentinel-11b1'
    const renderErrorSentinel = 'internal-render-error-sentinel-11b1'
    const failingRun: StudioRun = {
      ...createStudioRun({
        ownerId: OWNER,
        sessionId: session.id,
        sceneId: sceneA.id,
        inputText: 'fail',
        activeAgent: 'builder',
      }),
      id: 'run_private_error',
      error: runErrorSentinel,
      tokenUsage: { promptTokens: 3, completionTokens: 5, totalTokens: 8, measuredCalls: 1, unmeasuredCalls: 0 },
      createdAt: '2024-01-01T00:00:03.000Z',
    }
    const failingRender: StudioRender = {
      ...createStudioRender({
        ownerId: OWNER,
        sessionId: session.id,
        sceneId: sceneA.id,
        kind: 'manim',
        title: 'fail',
        concept: 'fail',
        outputMode: 'video',
      }),
      id: 'render_private_error',
      error: renderErrorSentinel,
      createdAt: '2024-01-01T00:00:04.000Z',
    }
    await persistence.runStore.create(failingRun)
    await persistence.renderStore.create(failingRender)

    const snapshot = await runtime.getSceneSnapshot(OWNER, session.id, sceneA.id)
    assert.ok(snapshot)
    const publicSnapshot = toPublicStudioSceneSnapshot(snapshot)

    assert.equal('ownerId' in publicSnapshot.scene, false)
    assert.equal('sourcePath' in publicSnapshot.scene, false)
    for (const entry of [...publicSnapshot.runs, ...publicSnapshot.renders]) {
      assert.equal('ownerId' in entry, false)
      // Internal error text is private to the Scene-scoped public response.
      assert.equal('error' in entry, false)
    }
    assert.deepEqual(publicSnapshot.scene, {
      id: sceneA.id,
      sessionId: session.id,
      position: sceneA.position,
      createdAt: sceneA.createdAt,
      updatedAt: sceneA.updatedAt,
    })

    const publicRun = publicSnapshot.runs.find((entry) => entry.id === failingRun.id)
    const publicRender = publicSnapshot.renders.find((entry) => entry.id === failingRender.id)
    assert.ok(publicRun)
    assert.ok(publicRender)
    assert.equal('error' in publicRun, false)
    assert.equal('error' in publicRender, false)
    // Ordinary public fields survive the narrowing.
    assert.equal(publicRun.status, failingRun.status)
    assert.deepEqual(publicRun.tokenUsage, failingRun.tokenUsage)
    assert.equal(publicRender.status, failingRender.status)
    assert.equal(publicRender.title, failingRender.title)

    const serialized = JSON.stringify(publicSnapshot)
    assert.equal(serialized.includes(session.ownerId), false)
    assert.equal(serialized.includes(session.directory), false)
    assert.equal(serialized.includes(sceneA.sourcePath), false)
    assert.equal(serialized.includes(runErrorSentinel), false)
    assert.equal(serialized.includes(renderErrorSentinel), false)

    // Pure conversion: the internal records still carry their own error text.
    assert.equal(snapshot.runs.find((entry) => entry.id === failingRun.id)?.error, runErrorSentinel)
    assert.equal(snapshot.renders.find((entry) => entry.id === failingRender.id)?.error, renderErrorSentinel)
    assert.equal(failingRun.error, runErrorSentinel)
    assert.equal(failingRender.error, renderErrorSentinel)

    // The global Session DTO is deliberately unchanged: it still publishes `error`.
    const sessionSnapshot = await runtime.getSessionSnapshot(OWNER, session.id)
    assert.ok(sessionSnapshot)
    assert.equal(
      toPublicStudioSnapshot(sessionSnapshot).runs.find((entry) => entry.id === failingRun.id)?.error,
      runErrorSentinel
    )
    assert.equal(
      toPublicStudioSnapshot(sessionSnapshot).renders.find((entry) => entry.id === failingRender.id)?.error,
      renderErrorSentinel
    )
  })

  await run('the session snapshot keeps legacy aggregates and scene-scoped records', async () => {
    const { persistence, runtime, session, scenes } = await createSceneFixture()
    const [sceneA, sceneB] = scenes
    await seedRecords({
      persistence,
      session,
      sceneId: sceneA.id,
      key: 'a',
      createdAt: '2024-01-01T00:00:00.000Z',
    })
    await seedRecords({
      persistence,
      session,
      sceneId: sceneB.id,
      key: 'b',
      createdAt: '2024-01-01T00:00:01.000Z',
    })
    await seedRecords({ persistence, session, key: 'legacy', createdAt: '2024-01-01T00:00:02.000Z' })

    const snapshot = await runtime.getSessionSnapshot(OWNER, session.id)

    assert.ok(snapshot)
    assert.equal(snapshot.session.id, session.id)
    assert.equal(snapshot.session.ownerId, OWNER)
    assert.equal(snapshot.session.directory, session.directory)
    // Session aggregates stay legacy-complete: both Scene-scoped and unscoped records.
    assert.deepEqual(
      snapshot.messages.map((message) => message.id),
      ['msg_a', 'msg_b', 'msg_legacy']
    )
    assert.deepEqual(
      snapshot.runs.map((entry) => entry.id),
      ['run_a', 'run_b', 'run_legacy']
    )
    assert.deepEqual(
      snapshot.renders.map((entry) => entry.id),
      ['render_a', 'render_b', 'render_legacy']
    )
    assert.deepEqual(
      snapshot.scenes.map((scene) => scene.id),
      [sceneA.id, sceneB.id]
    )
    assert.deepEqual(Object.keys(toPublicStudioSnapshot(snapshot)).sort(), [
      'messages',
      'renders',
      'runs',
      'scenes',
      'session',
    ])
  })

  await run('the scene scope migration keeps legacy rows nullable', async () => {
    const migration = readStudioSource('src', 'database', 'migrations', '011_add_studio_scene_scope.sql')

    for (const table of ['studio_messages', 'studio_runs', 'studio_renders']) {
      assert.match(
        migration,
        new RegExp(`alter table if exists ${table}\\s+add column if not exists scene_id text;`)
      )
    }
    assert.equal(countMatches(migration, /add column if not exists scene_id text;/g), 3)
    // No `not null`, no default and no guessed backfill: `NULL` stays the legacy marker.
    assert.doesNotMatch(migration, /scene_id text not null/i)
    assert.doesNotMatch(migration, /set scene_id/i)
    assert.doesNotMatch(migration, /update\s+studio_(messages|runs|renders)/i)
  })

  await run('the migration binds a scene to its own session', async () => {
    const migration = readStudioSource('src', 'database', 'migrations', '011_add_studio_scene_scope.sql')

    assert.match(migration, /add constraint studio_scenes_id_session_key unique \(id, session_id\);/)
    for (const [table, name] of [
      ['studio_messages', 'studio_messages_scene_session_fkey'],
      ['studio_runs', 'studio_runs_scene_session_fkey'],
      ['studio_renders', 'studio_renders_scene_session_fkey'],
    ]) {
      assert.match(
        migration,
        new RegExp(
          `add constraint ${name}\\s+foreign key \\(scene_id, session_id\\) references studio_scenes\\(id, session_id\\)`
        )
      )
      assert.match(migration, new RegExp(`${table}\\s+add constraint`))
    }
    // A composite foreign key needs the target key, and re-application must stay safe.
    assert.equal(countMatches(migration, /do \$\$/g), 2)
    assert.match(migration, /from pg_constraint/)
    assert.match(migration, /conrelid = to_regclass\('studio_/)
  })

  await run('deleting a scene cascades its scoped records', async () => {
    const migration = readStudioSource('src', 'database', 'migrations', '011_add_studio_scene_scope.sql')

    for (const name of [
      'studio_messages_scene_session_fkey',
      'studio_runs_scene_session_fkey',
      'studio_renders_scene_session_fkey',
    ]) {
      const start = migration.indexOf(name)
      assert.ok(start > 0, `${name} exists`)
      const clause = migration.slice(start, migration.indexOf(';', start))
      assert.match(clause, /on delete cascade/)
    }
    // The Scene-scoped lookup indexes match the read order of every adapter.
    assert.match(migration, /create index if not exists idx_studio_messages_scene_created\s+on studio_messages\(scene_id, created_at, id\);/)
    assert.match(migration, /create index if not exists idx_studio_runs_scene_created\s+on studio_runs\(scene_id, created_at, id\);/)
    assert.match(migration, /create index if not exists idx_studio_renders_scene_created\s+on studio_renders\(scene_id, created_at, id\);/)
  })

  await run('legacy session-level records stay representable in every store', async () => {
    const { persistence, session } = await createSceneFixture()
    const legacy = await seedRecords({
      persistence,
      session,
      key: 'legacy',
      createdAt: '2024-01-01T00:00:00.000Z',
    })

    assert.equal(Object.hasOwn(legacy.message, 'sceneId'), false)
    assert.equal((await persistence.messageStore.getById(legacy.message.id))?.sceneId, undefined)
    assert.deepEqual(
      (await persistence.messageStore.listBySessionId(session.id)).map((message) => message.id),
      [legacy.message.id]
    )
    assert.deepEqual(
      (await persistence.runStore.listBySessionId(OWNER, session.id)).map((entry) => entry.id),
      [legacy.run.id]
    )
    assert.deepEqual(
      (await persistence.renderStore.listBySessionId(OWNER, session.id)).map((entry) => entry.id),
      [legacy.render.id]
    )
    assert.equal(await persistence.runStore.getById(OWNER, legacy.run.id).then((entry) => entry?.sceneId), undefined)
  })

  await run('the scene snapshot route has one indistinguishable 404 path', async () => {
    const { runtime, session, scenes, otherSessionScene } = await createSceneFixture()
    const [sceneA] = scenes

    // Service level: absent Session, absent Scene, foreign owner and foreign Session all agree.
    const inaccessible = [
      await runtime.getSceneSnapshot(OWNER, session.id, 'scene_does_not_exist'),
      await runtime.getSceneSnapshot(OWNER, 'sess_does_not_exist', sceneA.id),
      await runtime.getSceneSnapshot(FOREIGN_OWNER, session.id, sceneA.id),
      await runtime.getSceneSnapshot(OWNER, session.id, otherSessionScene.id),
      await runtime.getSceneSnapshot(OWNER, session.id, ''),
    ]
    assert.deepEqual(inaccessible, [null, null, null, null, null])
    assert.ok(await runtime.getSceneSnapshot(OWNER, session.id, sceneA.id))

    // Route level: one handler, one 404 emit, and a body that names only the two path params.
    const route = readStudioSource('src', 'routes', 'studio-agent.route.ts')
    const handlerStart = route.indexOf("'/studio-agent/sessions/:sessionId/scenes/:sceneId'")
    assert.ok(handlerStart > 0, 'the scene snapshot route exists')
    const handlerEnd = route.indexOf('router.get(', handlerStart + 1)
    const handler = route.slice(handlerStart, handlerEnd < 0 ? route.length : handlerEnd)

    assert.equal(countMatches(handler, /404, 'NOT_FOUND'/g), 1)
    assert.equal(countMatches(handler, /'Scene not found'/g), 1)
    assert.match(handler, /\{\s*sessionId: req\.params\.sessionId,\s*sceneId: req\.params\.sceneId\s*\}/)
    // The only owner reference is the principal lookup: no ownership fact reaches the body.
    assert.equal(countMatches(handler, /ownerId/g), 1)
    assert.equal(countMatches(handler, /toPublicStudioSceneSnapshot/g), 1)
    // Infrastructure failure stays a separate, non-disclosing status.
    assert.equal(countMatches(handler, /503, 'SERVICE_UNAVAILABLE'/g), 1)
  })
}
