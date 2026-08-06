import assert from 'node:assert/strict'
import path from 'node:path'
import os from 'node:os'
import { mkdtemp, mkdir, readFile, symlink, writeFile } from 'node:fs/promises'
import {
  createStudioPrincipal,
  createStudioRun,
  createStudioSession,
  InMemoryStudioRunStore,
  InMemoryStudioSessionStore,
  InMemoryStudioEventBus,
  resolveSafeWorkspacePath,
  readWorkspaceFile,
  writeWorkspaceFile,
  StudioToolRegistry,
  createStudioReadTool,
  createStudioRenderTool,
} from '../../index'
import { buildStudioChatTools } from '../../orchestration/studio-tool-schema'
import { parseStudioCreateSessionRequest } from '../../../routes/helpers/studio-agent-run-request'
import { run } from './factories'

export async function runSecurityTests(): Promise<void> {
  await run('studio principal does not expose the raw API key', async () => {
    const principal = createStudioPrincipal('secret-api-key')
    assert.equal(principal.ownerId.length, 32)
    assert.equal('secret-api-key' in principal, false)
    assert.deepEqual(principal, createStudioPrincipal('secret-api-key'))
    assert.notEqual(principal.ownerId, createStudioPrincipal('another-api-key').ownerId)
  })

  await run('session and run stores isolate owners', async () => {
    const sessionStore = new InMemoryStudioSessionStore()
    const runStore = new InMemoryStudioRunStore()
    const session = createStudioSession({
      ownerId: 'owner-a',
      projectId: 'project',
      agentType: 'builder',
      title: 'Owner A',
      directory: 'workspace-a',
      permissionLevel: 'L4',
    })
    const runRecord = createStudioRun({
      ownerId: session.ownerId,
      sessionId: session.id,
      inputText: 'draw',
      activeAgent: 'builder',
    })

    await sessionStore.create(session)
    await runStore.create(runRecord)

    assert.equal(await sessionStore.getById('owner-b', session.id), null)
    assert.equal(await runStore.getById('owner-b', runRecord.id), null)
    assert.ok(await sessionStore.getById('owner-a', session.id))
    assert.ok(await runStore.getById('owner-a', runRecord.id))
  })

  await run('session creation rejects client supplied directories', async () => {
    assert.throws(
      () => parseStudioCreateSessionRequest({ projectId: 'project', directory: 'C:\\outside' }),
      /directory/
    )
  })

  await run('event bus only publishes to the subscribed session', async () => {
    const bus = new InMemoryStudioEventBus()
    const ownerAEvents: string[] = []
    const ownerBEvents: string[] = []
    const unsubscribeA = bus.subscribe('session-a', (event) => ownerAEvents.push(event.type))
    const unsubscribeB = bus.subscribe('session-b', (event) => ownerBEvents.push(event.type))

    bus.publish({
      type: 'assistant_text',
      sessionId: 'session-a',
      runId: 'run-a',
      messageId: 'message-a',
      text: 'private'
    })

    assert.deepEqual(ownerAEvents, ['assistant_text'])
    assert.deepEqual(ownerBEvents, [])
    unsubscribeA()
    unsubscribeB()
  })

  await run('workspace rejects traversal and symlink escape', async () => {
    const workspace = await mkdtemp(path.join(os.tmpdir(), 'manimcat-workspace-'))
    const outside = await mkdtemp(path.join(os.tmpdir(), 'manimcat-outside-'))
    await writeFile(path.join(outside, 'secret.py'), 'secret', 'utf8')
    await mkdir(path.join(workspace, 'linked'))
    await symlink(outside, path.join(workspace, 'linked', 'outside'), 'junction')

    await assert.rejects(
      () => resolveSafeWorkspacePath(workspace, '../outside.py'),
      /Workspace path must be relative|Path escapes workspace/
    )
    await assert.rejects(
      () => readWorkspaceFile(workspace, 'linked/outside/secret.py'),
      /Path escapes workspace/
    )
    await assert.rejects(
      () => writeWorkspaceFile(workspace, 'linked/outside/new.py', 'blocked'),
      /Path escapes workspace/
    )
    assert.equal(await readFile(path.join(outside, 'secret.py'), 'utf8'), 'secret')
  })

  await run('tool registry never falls back across Studio modes', async () => {
    const registry = new StudioToolRegistry()
    const manimRender = createStudioRenderTool({ submit: async ({ jobId }) => ({ jobId }) })
    registry.register(manimRender)
    assert.equal(registry.get('render', 'plot'), null)
    assert.equal(registry.require('render', 'manim'), manimRender)
    assert.deepEqual(
      buildStudioChatTools(registry, 'builder', 'manim')[0]?.function.parameters,
      manimRender.parameters
    )
    assert.throws(() => registry.register(createStudioRenderTool()), /Duplicate Studio tool registration/)
    assert.ok(createStudioReadTool().parameters)
  })
}
