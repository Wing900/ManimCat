import assert from 'node:assert/strict'
import path from 'node:path'
import os from 'node:os'
import { mkdir, mkdtemp, readFile, realpath, symlink, writeFile } from 'node:fs/promises'
import {
  createInMemoryStudioPersistence,
  createLegacyRunExecutionScope,
  createSceneRunExecutionScope,
  createStudioApplyPatchTool,
  createStudioAssistantMessage,
  createStudioEditTool,
  createStudioGlobTool,
  createStudioGrepTool,
  createStudioLsTool,
  createStudioReadTool,
  createStudioRender,
  createStudioRenderTool,
  createStudioStaticCheckTool,
  createStudioRun,
  createStudioScene,
  createStudioSession,
  createStudioUserMessage,
  createStudioWriteTool,
  InMemoryStudioEventBus,
  InMemoryStudioRenderStore,
  loadStudioRunExecutionScope,
  STUDIO_SCENE_DIRECTORY_PROMPT_LIMIT,
  StudioRunExecutionScopeError,
  StudioSessionRunner,
  StudioToolRegistry,
  StudioWorkspaceWriteDeniedError,
  hasSessionRelativeTraversalSegment,
  normalizeSessionRelativePath,
  truncateSceneDirectory,
  type PlotRenderPort,
  type ManimRenderPort,
  type StudioRun,
  type StudioRunExecutionScope,
  type StudioRuntimeBackedToolContext,
  type StudioScene,
  type StudioSceneStore,
  type StudioSession,
  type StudioStaticCheckPort,
  type StudioStaticCheckRequest,
  type StudioStaticCheckResult,
  type StudioToolDefinition,
  type StudioToolResult
} from '../../index'
import { buildStudioRenderContext } from '../../runtime/execution/render-context'
import { createStudioLoopRuntime, buildStudioLoopStepRequest } from '../../orchestration/openai-tool-loop/request-builder'
import { createStudioOpenAIToolLoop } from '../../orchestration/openai-tool-loop/controller'
import { configureStudioToolRegistry } from '../../runtime/studio-tool-registry'
import { buildStudioAgentSystemPrompt } from '../../orchestration/studio-agent-prompt'
import { createPlotStudioRenderTool } from '../../plot/tools/plot-render-tool'
import { ScriptedStudioModel } from '../support/scripted-studio-model'
import { run } from './factories'

/**
 * Task 11B2B — Scene context assembly and Tool write boundary.
 *
 * Contracts 1..35 of the task book. Everything runs on temporary directories, in-memory stores,
 * scripted model Ports and fake render Ports: no sleeps, network, Redis, PostgreSQL, Python,
 * Docker or real model call.
 */

const OWNER_ID = 'owner-scene-boundary'
const PROJECT_ID = 'project-scene-boundary'

interface SceneFixture {
  workspace: string
  session: StudioSession
  persistence: ReturnType<typeof createInMemoryStudioPersistence>
  scenes: StudioScene[]
}

async function createFixture(options?: {
  studioKind?: 'manim' | 'plot'
  sceneCount?: number
}): Promise<SceneFixture> {
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'manimcat-scene-boundary-'))
  const session = createStudioSession({
    ownerId: OWNER_ID,
    projectId: PROJECT_ID,
    agentType: 'builder',
    title: 'Scene boundary',
    directory: workspace,
    studioKind: options?.studioKind ?? 'manim'
  })
  const persistence = createInMemoryStudioPersistence()
  await persistence.sessionStore.create(session)

  const scenes: StudioScene[] = []
  const count = options?.sceneCount ?? 3
  // Seeded out of order on purpose: position 1 first, so a load that does not order would fail.
  const positions = count === 3 ? [1, 0, 2] : [...Array(count).keys()]
  for (let index = 0; index < count; index += 1) {
    const sceneId = `scene_${String(index).padStart(4, '0')}`
    const relativeSource = path.join('scenes', `${sceneId}.py`)
    const absoluteSource = path.join(workspace, relativeSource)
    await mkdir(path.dirname(absoluteSource), { recursive: true })
    await writeFile(absoluteSource, `# source of ${sceneId}\n`, 'utf8')
    scenes.push(await persistence.sceneStore.create(createStudioScene({
      ownerId: session.ownerId,
      sessionId: session.id,
      id: sceneId,
      position: positions[index],
      sourcePath: absoluteSource
    })))
  }

  return { workspace, session, persistence, scenes }
}

function sessionRunnerFor(fixture: SceneFixture, registry: StudioToolRegistry): StudioSessionRunner {
  return new StudioSessionRunner({
    registry,
    messageStore: fixture.persistence.messageStore,
    partStore: fixture.persistence.partStore,
    runStore: fixture.persistence.runStore,
    renderStore: fixture.persistence.renderStore,
    sceneStore: fixture.persistence.sceneStore
  })
}

function sharedRegistry(): StudioToolRegistry {
  const registry = new StudioToolRegistry()
  for (const tool of [
    createStudioReadTool(),
    createStudioLsTool(),
    createStudioGlobTool(),
    createStudioGrepTool(),
    createStudioWriteTool(),
    createStudioEditTool(),
    createStudioApplyPatchTool()
  ]) {
    registry.register(tool)
  }
  return registry
}

function toolContext(input: {
  session: StudioSession
  run: StudioRun
  executionScope: StudioRunExecutionScope
  eventBus?: InMemoryStudioEventBus
}): StudioRuntimeBackedToolContext {
  return {
    projectId: input.session.projectId,
    session: input.session,
    run: input.run,
    assistantMessage: createStudioAssistantMessage({
      sessionId: input.session.id,
      sceneId: input.run.sceneId,
      agent: 'builder'
    }),
    eventBus: input.eventBus ?? new InMemoryStudioEventBus(),
    renderStore: new InMemoryStudioRenderStore(),
    executionScope: input.executionScope
  }
}

function runFor(session: StudioSession, input?: { sceneId?: string }): StudioRun {
  return createStudioRun({
    ownerId: session.ownerId,
    sessionId: session.id,
    sceneId: input?.sceneId,
    inputText: 'draw something',
    activeAgent: 'builder'
  })
}

async function loadScope(
  fixture: SceneFixture,
  sceneId: string,
  sceneStore: StudioSceneStore = fixture.persistence.sceneStore
): Promise<StudioRunExecutionScope> {
  return loadStudioRunExecutionScope({
    session: fixture.session,
    sceneId,
    sceneStore
  })
}

/** The form an absolute path takes inside `JSON.stringify`, so the check cannot miss it. */
function jsonEscaped(value: string): string {
  return JSON.stringify(value).slice(1, -1)
}

function completion(content: string): never {
  return {
    id: 'completion-1',
    object: 'chat.completion',
    created: Date.now(),
    model: 'scripted',
    choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content } }]
  } as never
}

function toolCallCompletion(toolCallId: string, name: string, args: Record<string, unknown>): never {
  return {
    id: 'completion-tool',
    object: 'chat.completion',
    created: Date.now(),
    model: 'scripted',
    choices: [{
      index: 0,
      finish_reason: 'tool_calls',
      message: {
        role: 'assistant',
        content: null,
        tool_calls: [{ id: toolCallId, type: 'function', function: { name, arguments: JSON.stringify(args) } }]
      }
    }]
  } as never
}

class RecordingPlotRenderPort implements PlotRenderPort {
  readonly executed: Array<{ workspaceDirectory: string; renderId: string; code: string }> = []

  async execute(input: { workspaceDirectory: string; renderId: string; code: string }) {
    this.executed.push({ workspaceDirectory: input.workspaceDirectory, renderId: input.renderId, code: input.code })
    return {
      outputDir: path.join(input.workspaceDirectory, 'outputs'),
      scriptPath: path.join(input.workspaceDirectory, 'outputs', `${input.renderId}.py`),
      imageDataUris: [],
      imagePaths: [],
      stdout: '',
      stderr: ''
    }
  }
}

/** Static-check Port double: records the exact code the Tool handed to the static checker. */
class RecordingStaticCheckPort implements StudioStaticCheckPort {
  readonly checked: Array<{ kind: string; code: string; outputMode?: string }> = []

  async check(request: StudioStaticCheckRequest): Promise<StudioStaticCheckResult> {
    this.checked.push({ kind: request.kind, code: request.code, outputMode: request.outputMode })
    return { kind: request.kind, outputMode: request.outputMode ?? 'video', diagnostics: [] }
  }
}

/** Manim render Port double: records the workspace and code of every submitted job. */
class RecordingManimRenderPort implements ManimRenderPort {
  readonly submitted: Array<{ jobId: string; workspaceDirectory: string; code: string }> = []

  async submit(input: { jobId: string; workspaceDirectory: string; code: string }) {
    this.submitted.push({
      jobId: input.jobId,
      workspaceDirectory: input.workspaceDirectory,
      code: input.code
    })
    return { jobId: input.jobId }
  }
}

/** Stub mutation tool that reports the path the auto-render closure is allowed to trust. */
function stubMutationTool(name: string, resultPath: string | null): StudioToolDefinition {
  return {
    name,
    parameters: { type: 'object', properties: {}, required: [] } as never,
    description: `stub ${name}`,
    allowedAgents: ['builder'],
    execute: async (): Promise<StudioToolResult> => ({
      title: `stub ${name}`,
      output: 'ok',
      metadata: resultPath ? { path: resultPath } : {}
    })
  }
}

/**
 * Registry with exactly the plot render Tool plus the mutating Tool under test: the shared tool set
 * is deliberately not registered, so a stub cannot collide with the real `write` tool name.
 */
function autoRenderRegistry(renderPort: PlotRenderPort, mutationTool: StudioToolDefinition<any>): StudioToolRegistry {
  const registry = new StudioToolRegistry()
  registry.register(createPlotStudioRenderTool(renderPort))
  registry.register(mutationTool)
  return registry
}

async function collect<T>(generator: AsyncGenerator<T>): Promise<T[]> {
  const events: T[] = []
  for await (const event of generator) {
    events.push(event)
  }
  return events
}

export async function runSceneExecutionBoundaryTests(): Promise<void> {
  // ---------------------------------------------------------------- execution scope and context

  await run('scene execution scope loads the exact owner/session scene and a deterministic sibling directory', async () => {
    const fixture = await createFixture()
    const scope = await loadScope(fixture, 'scene_0001')

    assert.equal(scope.kind, 'scene')
    assert.ok(scope.kind === 'scene')
    assert.equal(scope.sceneId, 'scene_0001')
    assert.equal(scope.currentSourceRelativePath, 'scenes/scene_0001.py')
    assert.deepEqual(scope.workspaceAccess, { write: 'exact-file', relativePath: 'scenes/scene_0001.py' })
    assert.equal(scope.rootDirectory, fixture.workspace)
    assert.deepEqual(
      scope.scenes.map((entry) => `${entry.position}:${entry.id}:${entry.isCurrent}`),
      ['0:scene_0001:true', '1:scene_0000:false', '2:scene_0002:false']
    )
    // Only the relative form leaves the loader: no absolute filesystem path in the scope payload.
    // `currentSourcePath` is deliberately server-private and absolute; the projection that may
    // leave the server is the relative path and the Scene directory, and those carry no root.
    assert.equal(JSON.stringify(scope.scenes).includes(jsonEscaped(fixture.workspace)), false)
    assert.equal(scope.currentSourceRelativePath.includes(fixture.workspace), false)
    assert.ok(scope.scenes.every((entry) => !path.isAbsolute(entry.sourceRelativePath)))
  })

  await run('the scope stores the verified absolute current source path, not the persisted string', async () => {
    const fixture = await createFixture()
    const scope = await loadScope(fixture, 'scene_0001')
    assert.ok(scope.kind === 'scene')

    const verifiedRoot = await realpath(fixture.workspace)
    assert.equal(scope.currentSourcePath, path.join(verifiedRoot, 'scenes', 'scene_0001.py'))
    assert.equal(path.isAbsolute(scope.currentSourcePath), true)
    assert.equal(scope.currentSourceRelativePath, 'scenes/scene_0001.py')
    assert.deepEqual(scope.workspaceAccess, { write: 'exact-file', relativePath: 'scenes/scene_0001.py' })
  })

  await run('a persisted current source spelling with a parent segment fails closed', async () => {
    const fixture = await createFixture()
    // The Scene store is server data, not model input, so a non-canonical stored spelling must be
    // refused instead of being normalized into a write policy.
    await fixture.persistence.sceneStore.create(createStudioScene({
      ownerId: fixture.session.ownerId,
      sessionId: fixture.session.id,
      id: 'scene_traversal_source',
      position: 30,
      sourcePath: 'scenes/../scenes/scene_0001.py'
    }))
    await assert.rejects(
      () => loadScope(fixture, 'scene_traversal_source'),
      (error: unknown) => error instanceof StudioRunExecutionScopeError && error.reason === 'unsafe_scene_source'
    )
  })

  await run('raw persisted traversal is refused before resolution for both separators', async () => {
    const fixture = await createFixture()
    // Each spelling below normalizes onto a file that really exists, so a `path.resolve`-first
    // implementation would accept it. The raw value is what decides. The absolute spelling is built
    // by concatenation because `path.join` would normalize the parent segment away before the check.
    const separator = path.sep
    const spellings = [
      { id: 'scene_traversal_slash', sourcePath: 'scenes/../scenes/scene_0001.py' },
      { id: 'scene_traversal_backslash', sourcePath: 'scenes\\..\\scenes\\scene_0001.py' },
      {
        id: 'scene_traversal_absolute',
        sourcePath: `${fixture.workspace}${separator}scenes${separator}..${separator}scenes${separator}scene_0001.py`
      }
    ]

    for (const [index, spelling] of spellings.entries()) {
      assert.equal(path.isAbsolute(spelling.sourcePath), spelling.id === 'scene_traversal_absolute')
      if (spelling.id === 'scene_traversal_backslash') {
        // The shared rule splits on both separators by design, whatever the host path flavor is; on
        // POSIX such a name is one literal file name, so only the rule itself is asserted here.
        assert.equal(hasSessionRelativeTraversalSegment(spelling.sourcePath), true)
      } else {
        // The normalization would land on the legitimate source file of scene_0001.
        assert.equal(
          normalizeSessionRelativePath(
            path.relative(fixture.workspace, path.resolve(fixture.workspace, spelling.sourcePath))
          ),
          'scenes/scene_0001.py'
        )
      }

      await fixture.persistence.sceneStore.create(createStudioScene({
        ownerId: fixture.session.ownerId,
        sessionId: fixture.session.id,
        id: spelling.id,
        position: 40 + index,
        sourcePath: spelling.sourcePath
      }))

      await assert.rejects(
        () => loadScope(fixture, spelling.id),
        (error: unknown) => error instanceof StudioRunExecutionScopeError && error.reason === 'unsafe_scene_source'
      )
    }

    // A canonical absolute persisted path keeps working, and every rejected Scene stayed out of the
    // sibling directory of a healthy Run.
    const scope = await loadScope(fixture, 'scene_0001')
    assert.ok(scope.kind === 'scene')
    assert.equal(scope.currentSourceRelativePath, 'scenes/scene_0001.py')
    assert.deepEqual(scope.scenes.map((entry) => entry.id), ['scene_0001', 'scene_0000', 'scene_0002'])
    assert.equal(scope.scenes.some((entry) => entry.sourceRelativePath.includes('..')), false)
  })

  await run('a sibling scene with a raw traversal spelling is omitted while the run continues', async () => {
    const fixture = await createFixture()
    // The broken sibling normalizes onto the real scene_0002 file; it still may not enter the
    // directory the prompt is built from.
    await fixture.persistence.sceneStore.create(createStudioScene({
      ownerId: fixture.session.ownerId,
      sessionId: fixture.session.id,
      id: 'scene_sibling_traversal',
      position: 50,
      sourcePath: 'scenes/../scenes/scene_0002.py'
    }))

    const scope = await loadScope(fixture, 'scene_0000')
    assert.ok(scope.kind === 'scene')
    assert.deepEqual(
      scope.scenes.map((entry) => [entry.id, entry.sourceRelativePath]),
      [
        ['scene_0001', 'scenes/scene_0001.py'],
        ['scene_0000', 'scenes/scene_0000.py'],
        ['scene_0002', 'scenes/scene_0002.py']
      ]
    )

    // And the Run itself starts: one unusable neighbour never stops the current Scene.
    const model = new ScriptedStudioModel([completion('done')])
    const runner = sessionRunnerFor(fixture, sharedRegistry())
    const started = await runner.startBackgroundRun({
      projectId: PROJECT_ID,
      session: fixture.session,
      sceneId: 'scene_0000',
      inputText: 'draw',
      modelPort: model
    })
    await started.completion
  })

  await run('missing, foreign-owner and foreign-session current scenes fail closed', async () => {
    const fixture = await createFixture()

    await assert.rejects(
      () => loadScope(fixture, 'scene_missing'),
      (error: unknown) => error instanceof StudioRunExecutionScopeError && error.reason === 'scene_not_found'
    )

    await fixture.persistence.sceneStore.create(createStudioScene({
      ownerId: 'owner-somebody-else',
      sessionId: fixture.session.id,
      id: 'scene_foreign_owner',
      position: 9,
      sourcePath: path.join(fixture.workspace, 'scenes', 'scene_foreign_owner.py')
    }))
    await assert.rejects(
      () => loadScope(fixture, 'scene_foreign_owner'),
      (error: unknown) => error instanceof StudioRunExecutionScopeError && error.reason === 'scene_not_found'
    )

    await fixture.persistence.sceneStore.create(createStudioScene({
      ownerId: fixture.session.ownerId,
      sessionId: 'session-of-somebody-else',
      id: 'scene_foreign_session',
      position: 0,
      sourcePath: path.join(fixture.workspace, 'scenes', 'scene_foreign_session.py')
    }))
    await assert.rejects(
      () => loadScope(fixture, 'scene_foreign_session'),
      (error: unknown) => error instanceof StudioRunExecutionScopeError && error.reason === 'scene_not_found'
    )
  })

  await run('an unsafe current source path fails the run before provider invocation', async () => {
    const fixture = await createFixture()
    const outsideRoot = await mkdtemp(path.join(os.tmpdir(), 'manimcat-outside-scene-'))
    await writeFile(path.join(outsideRoot, 'escaped.py'), '# escaped\n', 'utf8')
    await fixture.persistence.sceneStore.create(createStudioScene({
      ownerId: fixture.session.ownerId,
      sessionId: fixture.session.id,
      id: 'scene_escaped',
      position: 5,
      sourcePath: path.join(outsideRoot, 'escaped.py')
    }))

    const model = new ScriptedStudioModel([completion('never reached')])
    const runner = sessionRunnerFor(fixture, sharedRegistry())
    await assert.rejects(
      () => runner.startBackgroundRun({
        projectId: PROJECT_ID,
        session: fixture.session,
        sceneId: 'scene_escaped',
        inputText: 'draw',
        modelPort: model
      }),
      (error: unknown) => error instanceof StudioRunExecutionScopeError && error.reason === 'unsafe_scene_source'
    )

    assert.equal(model.requests.length, 0)
    assert.deepEqual(await fixture.persistence.runStore.listBySessionId(fixture.session.ownerId, fixture.session.id), [])
    assert.deepEqual(await fixture.persistence.messageStore.listBySessionId(fixture.session.id), [])
  })

  await run('a missing, non-file, symlinked or symlink-ancestor current source fails closed before the model', async () => {
    const fixture = await createFixture()
    const scenesDirectory = path.join(fixture.workspace, 'scenes')
    const realDirectory = path.join(scenesDirectory, 'real_current')
    const linkedDirectory = path.join(scenesDirectory, 'linked_current_dir')
    await mkdir(realDirectory, { recursive: true })
    await writeFile(path.join(realDirectory, 'real.py'), '# real source\n', 'utf8')
    await symlink(realDirectory, linkedDirectory, 'junction')
    await mkdir(path.join(scenesDirectory, 'a_directory.py'), { recursive: true })
    await symlink(
      path.join(scenesDirectory, 'scene_0000.py'),
      path.join(scenesDirectory, 'symlinked_current.py'),
      'file'
    )

    const brokenSources = [
      { id: 'scene_missing_file', sourcePath: path.join(scenesDirectory, 'never_written.py') },
      { id: 'scene_directory_source', sourcePath: path.join(scenesDirectory, 'a_directory.py') },
      { id: 'scene_symlink_source', sourcePath: path.join(scenesDirectory, 'symlinked_current.py') },
      { id: 'scene_symlink_ancestor_source', sourcePath: path.join(linkedDirectory, 'real.py') }
    ]

    for (const [index, broken] of brokenSources.entries()) {
      await fixture.persistence.sceneStore.create(createStudioScene({
        ownerId: fixture.session.ownerId,
        sessionId: fixture.session.id,
        id: broken.id,
        position: 20 + index,
        sourcePath: broken.sourcePath
      }))

      // No scope is assembled at all: the preflight refuses the unusable source.
      await assert.rejects(
        () => loadScope(fixture, broken.id),
        (error: unknown) => error instanceof StudioRunExecutionScopeError && error.reason === 'unsafe_scene_source'
      )

      // And a Run never reaches the provider or persists a record for it.
      const model = new ScriptedStudioModel([completion('never reached')])
      await assert.rejects(
        () => sessionRunnerFor(fixture, sharedRegistry()).startBackgroundRun({
          projectId: PROJECT_ID,
          session: fixture.session,
          sceneId: broken.id,
          inputText: 'draw',
          modelPort: model
        }),
        (error: unknown) => error instanceof StudioRunExecutionScopeError && error.reason === 'unsafe_scene_source'
      )
      assert.equal(model.requests.length, 0)
      assert.deepEqual(await fixture.persistence.runStore.listBySessionId(fixture.session.ownerId, fixture.session.id), [])
      assert.deepEqual(await fixture.persistence.messageStore.listBySessionId(fixture.session.id), [])
    }

    // A valid regular source still assembles a scope.
    const validScope = await loadScope(fixture, 'scene_0001')
    assert.ok(validScope.kind === 'scene')
    assert.equal(validScope.currentSourceRelativePath, 'scenes/scene_0001.py')
  })

  await run('an unsafe sibling path is omitted without leaking its absolute path', async () => {
    const fixture = await createFixture()
    const outsideRoot = await mkdtemp(path.join(os.tmpdir(), 'manimcat-outside-sibling-'))
    await writeFile(path.join(outsideRoot, 'sibling.py'), '# outside\n', 'utf8')
    await fixture.persistence.sceneStore.create(createStudioScene({
      ownerId: fixture.session.ownerId,
      sessionId: fixture.session.id,
      id: 'scene_outside',
      position: 7,
      sourcePath: path.join(outsideRoot, 'sibling.py')
    }))

    const scope = await loadScope(fixture, 'scene_0001')
    assert.ok(scope.kind === 'scene')
    assert.deepEqual(scope.scenes.map((entry) => entry.id), ['scene_0001', 'scene_0000', 'scene_0002'])
    assert.equal(JSON.stringify(scope).includes(outsideRoot), false)
    assert.equal(JSON.stringify(scope).includes('sibling.py'), false)
  })

  await run('scene conversation contains only that scene messages', async () => {
    const fixture = await createFixture()
    const sceneId = 'scene_0001'
    await fixture.persistence.messageStore.createUserMessage(createStudioUserMessage({ sessionId: fixture.session.id, sceneId, text: 'scene one ask' }))
    await fixture.persistence.messageStore.createUserMessage(createStudioUserMessage({ sessionId: fixture.session.id, sceneId: 'scene_0000', text: 'sibling ask' }))
    await fixture.persistence.messageStore.createUserMessage(createStudioUserMessage({ sessionId: fixture.session.id, text: 'legacy ask' }))

    const runRecord = runFor(fixture.session, { sceneId })
    const runtime = await createStudioLoopRuntime({
      projectId: PROJECT_ID,
      session: fixture.session,
      run: runRecord,
      assistantMessage: createStudioAssistantMessage({ sessionId: fixture.session.id, sceneId, agent: 'builder' }),
      inputText: runRecord.inputText,
      messageStore: fixture.persistence.messageStore,
      registry: sharedRegistry(),
      eventBus: new InMemoryStudioEventBus(),
      executionScope: await loadScope(fixture, sceneId),
      createAssistantMessage: async () => createStudioAssistantMessage({
        sessionId: fixture.session.id,
        sceneId: 'scene_0001',
        agent: 'builder'
      }),
      setToolMetadata: () => undefined,
      modelPort: new ScriptedStudioModel([completion('unused')])
    })

    const request = buildStudioLoopStepRequest(runtime)
    const conversationText = JSON.stringify(request.messages)
    assert.ok(conversationText.includes('scene one ask'))
    assert.equal(conversationText.includes('sibling ask'), false)
    assert.equal(conversationText.includes('legacy ask'), false)
    assert.equal(runtime.conversation.length, 1)
  })

  await run('scene conversation excludes sibling and legacy messages', async () => {
    const fixture = await createFixture()
    await fixture.persistence.messageStore.createUserMessage(createStudioUserMessage({ sessionId: fixture.session.id, sceneId: 'scene_0000', text: 'sibling only' }))
    await fixture.persistence.messageStore.createUserMessage(createStudioUserMessage({ sessionId: fixture.session.id, text: 'legacy only' }))

    const sceneId = 'scene_0002'
    await fixture.persistence.messageStore.createUserMessage(createStudioUserMessage({ sessionId: fixture.session.id, sceneId, text: 'mine' }))

    const runtime = await createStudioLoopRuntime({
      projectId: PROJECT_ID,
      session: fixture.session,
      run: runFor(fixture.session, { sceneId }),
      assistantMessage: createStudioAssistantMessage({ sessionId: fixture.session.id, sceneId, agent: 'builder' }),
      inputText: 'ask',
      messageStore: fixture.persistence.messageStore,
      registry: sharedRegistry(),
      eventBus: new InMemoryStudioEventBus(),
      executionScope: await loadScope(fixture, sceneId),
      createAssistantMessage: async () => createStudioAssistantMessage({
        sessionId: fixture.session.id,
        sceneId: 'scene_0001',
        agent: 'builder'
      }),
      setToolMetadata: () => undefined,
      modelPort: new ScriptedStudioModel([completion('unused')])
    })

    assert.deepEqual(
      runtime.conversation.map((message) => message.role === 'user' ? message.content : message.role),
      ['mine']
    )
  })

  await run('legacy conversation retains the complete session history', async () => {
    const fixture = await createFixture()
    await fixture.persistence.messageStore.createUserMessage(createStudioUserMessage({ sessionId: fixture.session.id, sceneId: 'scene_0000', text: 'scene ask' }))
    await fixture.persistence.messageStore.createUserMessage(createStudioUserMessage({ sessionId: fixture.session.id, text: 'legacy ask' }))

    const runtime = await createStudioLoopRuntime({
      projectId: PROJECT_ID,
      session: fixture.session,
      run: runFor(fixture.session),
      assistantMessage: createStudioAssistantMessage({ sessionId: fixture.session.id, agent: 'builder' }),
      inputText: 'ask',
      messageStore: fixture.persistence.messageStore,
      registry: sharedRegistry(),
      eventBus: new InMemoryStudioEventBus(),
      executionScope: createLegacyRunExecutionScope({ rootDirectory: fixture.workspace }),
      createAssistantMessage: async () => createStudioAssistantMessage({
        sessionId: fixture.session.id,
        agent: 'builder'
      }),
      setToolMetadata: () => undefined,
      modelPort: new ScriptedStudioModel([completion('unused')])
    })

    assert.equal(runtime.conversation.length, 2)
    const text = JSON.stringify(runtime.conversation)
    assert.ok(text.includes('scene ask'))
    assert.ok(text.includes('legacy ask'))
  })

  await run('scene render context selects only that scene latest render', async () => {
    const fixture = await createFixture()
    const renderStore = fixture.persistence.renderStore
    const sceneRender = await renderStore.create(createStudioRender({
      ownerId: OWNER_ID,
      sessionId: fixture.session.id,
      sceneId: 'scene_0001',
      kind: 'manim',
      title: 'scene render',
      concept: 'scene',
      outputMode: 'video',
      status: 'completed'
    }))
    await renderStore.create(createStudioRender({
      ownerId: OWNER_ID,
      sessionId: fixture.session.id,
      sceneId: 'scene_0000',
      kind: 'manim',
      title: 'sibling render',
      concept: 'sibling',
      outputMode: 'video',
      status: 'failed'
    }))

    const context = await buildStudioRenderContext({
      ownerId: OWNER_ID,
      sessionId: fixture.session.id,
      sceneId: 'scene_0001',
      agent: 'builder',
      renderStore
    })

    assert.equal(context.latestRender?.id, sceneRender.id)
    assert.equal(context.latestRender?.status, 'completed')
  })

  await run('a newer sibling render cannot replace the current scene render context', async () => {
    const fixture = await createFixture()
    const renderStore = fixture.persistence.renderStore
    const sceneRender = await renderStore.create(createStudioRender({
      ownerId: OWNER_ID,
      sessionId: fixture.session.id,
      sceneId: 'scene_0001',
      kind: 'manim',
      title: 'older scene render',
      concept: 'scene',
      outputMode: 'video',
      status: 'completed'
    }))
    await renderStore.update(OWNER_ID, sceneRender.id, { status: 'completed' })
    const siblingRender = await renderStore.create(createStudioRender({
      ownerId: OWNER_ID,
      sessionId: fixture.session.id,
      sceneId: 'scene_0002',
      kind: 'manim',
      title: 'newer sibling render',
      concept: 'sibling',
      outputMode: 'video',
      status: 'completed'
    }))
    await fixture.persistence.renderStore.update(OWNER_ID, siblingRender.id, { status: 'completed' })

    const context = await buildStudioRenderContext({
      ownerId: OWNER_ID,
      sessionId: fixture.session.id,
      sceneId: 'scene_0001',
      agent: 'builder',
      renderStore
    })

    assert.equal(context.latestRender?.id, sceneRender.id)
    assert.notEqual(context.latestRender?.id, siblingRender.id)
    // The sibling is genuinely newer, so this is a scope decision, not an ordering artifact.
    const sibling = await renderStore.getById(OWNER_ID, siblingRender.id)
    const mine = await renderStore.getById(OWNER_ID, sceneRender.id)
    assert.ok(Date.parse(sibling!.updatedAt) >= Date.parse(mine!.updatedAt))
  })

  await run('legacy render context retains session-wide latest-render behavior', async () => {
    const fixture = await createFixture()
    const renderStore = fixture.persistence.renderStore
    await renderStore.create(createStudioRender({
      ownerId: OWNER_ID,
      sessionId: fixture.session.id,
      sceneId: 'scene_0001',
      kind: 'manim',
      title: 'scene render',
      concept: 'scene',
      outputMode: 'video',
      status: 'completed'
    }))
    const legacyRender = await renderStore.create(createStudioRender({
      ownerId: OWNER_ID,
      sessionId: fixture.session.id,
      kind: 'manim',
      title: 'legacy render',
      concept: 'legacy',
      outputMode: 'video',
      status: 'completed'
    }))

    const context = await buildStudioRenderContext({
      ownerId: OWNER_ID,
      sessionId: fixture.session.id,
      agent: 'builder',
      renderStore
    })

    assert.equal(context.latestRender?.id, legacyRender.id)
  })

  await run('finalization returns the latest assistant message in the run scene', async () => {
    const fixture = await createFixture()
    const sceneId = 'scene_0001'
    const model = new ScriptedStudioModel([completion('scene one answer')])
    const runner = sessionRunnerFor(fixture, sharedRegistry())

    const handle = await runner.startBackgroundRun({
      projectId: PROJECT_ID,
      session: fixture.session,
      sceneId,
      inputText: 'draw',
      modelPort: model
    })
    const result = await handle.completion

    assert.equal(result.run.sceneId, sceneId)
    assert.equal(result.assistantMessage.sceneId, sceneId)
    assert.equal(result.text, 'scene one answer')
    // A sibling assistant message created later must not be picked as this Run's result.
    await fixture.persistence.messageStore.createAssistantMessage(createStudioAssistantMessage({
      sessionId: fixture.session.id,
      sceneId: 'scene_0002',
      agent: 'builder'
    }))
    assert.equal(result.assistantMessage.sceneId, sceneId)
  })

  await run('a concurrent sibling assistant message cannot become scene A result', async () => {
    const fixture = await createFixture()
    const sceneId = 'scene_0001'
    // Sibling written first with a newer timestamp than the Scene message finalization will find.
    const siblingMessage = createStudioAssistantMessage({
      sessionId: fixture.session.id,
      sceneId: 'scene_0000',
      agent: 'builder'
    })
    await fixture.persistence.messageStore.createAssistantMessage(siblingMessage)

    const model = new ScriptedStudioModel([completion('scene one answer')])
    const runner = sessionRunnerFor(fixture, sharedRegistry())
    const handle = await runner.startBackgroundRun({
      projectId: PROJECT_ID,
      session: fixture.session,
      sceneId,
      inputText: 'draw',
      modelPort: model
    })
    const result = await handle.completion

    assert.notEqual(result.assistantMessage.id, siblingMessage.id)
    assert.equal(result.assistantMessage.sceneId, sceneId)
    assert.equal(result.text, 'scene one answer')
  })

  await run('later assistant messages created during the loop preserve run sceneId', async () => {
    const fixture = await createFixture()
    const sceneId = 'scene_0001'
    const model = new ScriptedStudioModel([
      toolCallCompletion('call-1', 'ls', { path: '.' }),
      completion('finished')
    ])
    const runner = sessionRunnerFor(fixture, sharedRegistry())
    const handle = await runner.startBackgroundRun({
      projectId: PROJECT_ID,
      session: fixture.session,
      sceneId,
      inputText: 'draw',
      modelPort: model
    })
    await handle.completion

    const sceneMessages = await fixture.persistence.messageStore.listBySceneId(sceneId)
    const assistants = sceneMessages.filter((message) => message.role === 'assistant')
    assert.equal(assistants.length, 2)
    assert.ok(assistants.every((message) => message.sceneId === sceneId))

    const legacyModel = new ScriptedStudioModel([
      toolCallCompletion('call-2', 'ls', { path: '.' }),
      completion('finished')
    ])
    const legacyHandle = await sessionRunnerFor(fixture, sharedRegistry()).startBackgroundRun({
      projectId: PROJECT_ID,
      session: fixture.session,
      inputText: 'draw',
      modelPort: legacyModel
    })
    await legacyHandle.completion

    const legacyAssistants = (await fixture.persistence.messageStore.listBySessionId(fixture.session.id))
      .filter((message) => message.role === 'assistant' && message.sceneId === undefined)
    assert.equal(legacyAssistants.length, 2)
    assert.ok(legacyAssistants.every((message) => !('sceneId' in message)))
  })

  // ------------------------------------------------------------------------------- prompt facts

  await run('scene prompt contains current relative source, write scope and ordered scene directory', async () => {
    const fixture = await createFixture()
    const scope = await loadScope(fixture, 'scene_0001')
    const prompt = buildStudioAgentSystemPrompt({ session: fixture.session, executionScope: scope })

    assert.ok(prompt.includes('<studio_scene_scope>'))
    assert.ok(prompt.includes('current_scene_id: scene_0001'))
    assert.ok(prompt.includes('current_source: scenes/scene_0001.py'))
    assert.ok(prompt.includes('write_scope: current_source_only'))
    assert.ok(prompt.includes('read_scope: session_workspace'))
    const directoryLines = prompt.split('\n').filter((line) => line.startsWith('- position:'))
    assert.deepEqual(directoryLines, [
      '- position: 0; id: scene_0001; source: scenes/scene_0001.py; current: true',
      '- position: 1; id: scene_0000; source: scenes/scene_0000.py; current: false',
      '- position: 2; id: scene_0002; source: scenes/scene_0002.py; current: false'
    ])
  })

  await run('scene prompt contains no absolute source path, owner id or source code', async () => {
    const fixture = await createFixture()
    const scope = await loadScope(fixture, 'scene_0001')
    const prompt = buildStudioAgentSystemPrompt({ session: fixture.session, executionScope: scope })
    const block = prompt.slice(
      prompt.indexOf('<studio_scene_scope>'),
      prompt.indexOf('</studio_scene_scope>') + '</studio_scene_scope>'.length
    )

    assert.equal(block.includes(fixture.workspace), false)
    assert.equal(block.includes('\\'), false)
    assert.equal(block.includes(fixture.session.ownerId), false)
    assert.equal(block.includes('# source of'), false)
    assert.ok(block.includes('scenes/scene_0001.py'))
  })

  await run('scene directory truncation is deterministic and explicitly marked', async () => {
    const fixture = await createFixture({ sceneCount: STUDIO_SCENE_DIRECTORY_PROMPT_LIMIT + 3 })
    const scope = await loadScope(fixture, 'scene_0000')
    assert.ok(scope.kind === 'scene')

    const prompt = buildStudioAgentSystemPrompt({ session: fixture.session, executionScope: scope })
    const directoryLines = prompt.split('\n').filter((line) => line.startsWith('- position:'))
    assert.equal(directoryLines.length, STUDIO_SCENE_DIRECTORY_PROMPT_LIMIT)
    assert.ok(prompt.includes('scene_directory_truncated: true; omitted_count: 3'))
    // Deterministic: the ordered head is kept, twice in a row.
    const again = buildStudioAgentSystemPrompt({ session: fixture.session, executionScope: scope })
    assert.equal(again, prompt)

    const bounded = truncateSceneDirectory(scope.scenes, 2)
    assert.deepEqual(bounded.entries.map((entry) => entry.id), ['scene_0000', 'scene_0001'])
    assert.equal(bounded.truncated, true)
    assert.equal(bounded.omittedCount, scope.scenes.length - 2)
  })

  await run('legacy prompt remains byte-for-byte equal to its pre-task output', async () => {
    const fixture = await createFixture()
    const renderContext = {
      sessionId: fixture.session.id,
      agent: 'builder' as const,
      latestRender: { id: 'render_fixture', status: 'completed' as const, timestamp: 1700000000000 }
    }

    // Pre-task call shape: no execution scope argument at all.
    const preTask = buildStudioAgentSystemPrompt({ session: fixture.session, renderContext })
    const withLegacyScope = buildStudioAgentSystemPrompt({
      session: fixture.session,
      renderContext,
      executionScope: createLegacyRunExecutionScope({ rootDirectory: fixture.workspace })
    })

    assert.equal(withLegacyScope, preTask)
    assert.equal(preTask.includes('<studio_scene_scope>'), false)
    assert.ok(preTask.includes('<studio_render_context>'))
  })

  // ------------------------------------------------------------------------------ write boundary

  await run('scene write succeeds on the exact current source', async () => {
    const fixture = await createFixture()
    const scope = await loadScope(fixture, 'scene_0001')
    const context = toolContext({ session: fixture.session, run: runFor(fixture.session, { sceneId: 'scene_0001' }), executionScope: scope })

    const result = await createStudioWriteTool().execute({ path: 'scenes/scene_0001.py', content: 'print("one")\n' }, context)

    assert.equal(result.metadata?.path, 'scenes/scene_0001.py')
    assert.equal(await readFile(path.join(fixture.workspace, 'scenes', 'scene_0001.py'), 'utf8'), 'print("one")\n')
  })

  await run('scene edit succeeds on the exact current source', async () => {
    const fixture = await createFixture()
    const scope = await loadScope(fixture, 'scene_0001')
    const context = toolContext({ session: fixture.session, run: runFor(fixture.session, { sceneId: 'scene_0001' }), executionScope: scope })

    const result = await createStudioEditTool().execute({
      path: 'scenes/scene_0001.py',
      search: '# source of scene_0001',
      replace: '# edited scene_0001'
    }, context)

    assert.equal(result.metadata?.replacements, 1)
    assert.equal(
      await readFile(path.join(fixture.workspace, 'scenes', 'scene_0001.py'), 'utf8'),
      '# edited scene_0001\n'
    )
  })

  await run('scene apply_patch succeeds on the exact current source', async () => {
    const fixture = await createFixture()
    const scope = await loadScope(fixture, 'scene_0001')
    const context = toolContext({ session: fixture.session, run: runFor(fixture.session, { sceneId: 'scene_0001' }), executionScope: scope })

    const result = await createStudioApplyPatchTool().execute({
      path: 'scenes/scene_0001.py',
      patches: [{ search: 'source of scene_0001', replace: 'patched scene_0001' }]
    }, context)

    assert.equal(result.metadata?.patchCount, 1)
    assert.equal(
      await readFile(path.join(fixture.workspace, 'scenes', 'scene_0001.py'), 'utf8'),
      '# patched scene_0001\n'
    )
  })

  await run('all three mutation tools deny a sibling scene source', async () => {
    const fixture = await createFixture()
    const scope = await loadScope(fixture, 'scene_0001')
    const context = toolContext({ session: fixture.session, run: runFor(fixture.session, { sceneId: 'scene_0001' }), executionScope: scope })
    const sibling = path.join(fixture.workspace, 'scenes', 'scene_0000.py')
    const before = await readFile(sibling, 'utf8')

    await assert.rejects(
      () => createStudioWriteTool().execute({ path: 'scenes/scene_0000.py', content: 'clobbered' }, context),
      (error: unknown) => error instanceof StudioWorkspaceWriteDeniedError && error.reason === 'not_authorized_target'
    )
    await assert.rejects(
      () => createStudioEditTool().execute({ path: 'scenes/scene_0000.py', search: 'source', replace: 'clobbered' }, context),
      (error: unknown) => error instanceof StudioWorkspaceWriteDeniedError && error.reason === 'not_authorized_target'
    )
    await assert.rejects(
      () => createStudioApplyPatchTool().execute({ path: 'scenes/scene_0000.py', patches: [{ search: 'source', replace: 'clobbered' }] }, context),
      (error: unknown) => error instanceof StudioWorkspaceWriteDeniedError && error.reason === 'not_authorized_target'
    )
    assert.equal(await readFile(sibling, 'utf8'), before)
  })

  await run('all three mutation tools deny another session file and a new arbitrary file', async () => {
    const fixture = await createFixture()
    const scope = await loadScope(fixture, 'scene_0001')
    const context = toolContext({ session: fixture.session, run: runFor(fixture.session, { sceneId: 'scene_0001' }), executionScope: scope })
    await writeFile(path.join(fixture.workspace, 'notes.md'), 'existing notes\n', 'utf8')

    for (const target of ['notes.md', 'scenes/brand_new.py', 'scenes/scene_0001_extra.py']) {
      await assert.rejects(
        () => createStudioWriteTool().execute({ path: target, content: 'x' }, context),
        (error: unknown) => error instanceof StudioWorkspaceWriteDeniedError && error.reason === 'not_authorized_target'
      )
      await assert.rejects(
        () => createStudioEditTool().execute({ path: target, search: 'a', replace: 'b' }, context),
        (error: unknown) => error instanceof StudioWorkspaceWriteDeniedError && error.reason === 'not_authorized_target'
      )
      await assert.rejects(
        () => createStudioApplyPatchTool().execute({ path: target, patches: [{ search: 'a', replace: 'b' }] }, context),
        (error: unknown) => error instanceof StudioWorkspaceWriteDeniedError && error.reason === 'not_authorized_target'
      )
    }

    assert.equal(await readFile(path.join(fixture.workspace, 'notes.md'), 'utf8'), 'existing notes\n')
  })

  await run('absolute, drive-qualified, UNC, traversal and null-byte targets fail closed', async () => {
    const fixture = await createFixture()
    const scope = await loadScope(fixture, 'scene_0001')
    const context = toolContext({ session: fixture.session, run: runFor(fixture.session, { sceneId: 'scene_0001' }), executionScope: scope })

    const targets = [
      path.join(fixture.workspace, 'scenes', 'scene_0001.py'),
      'C:\\Windows\\system32\\drivers\\etc\\hosts',
      '\\\\server\\share\\scene_0001.py',
      '../scene_0001.py',
      'scenes/../scene_0001.py',
      'scenes/scene_0001.py\u0000'
    ]

    for (const target of targets) {
      await assert.rejects(
        () => createStudioWriteTool().execute({ path: target, content: 'x' }, context),
        (error: unknown) => error instanceof StudioWorkspaceWriteDeniedError
      )
    }

    // The parent-segment syntax rule is separator agnostic and platform independent: a backslash
    // spelling is refused exactly like a slash spelling, on every host.
    const traversalSpellings = ['scenes/../scenes/scene_0001.py', 'scenes\\..\\scenes\\scene_0001.py']
    for (const spelling of traversalSpellings) {
      assert.equal(hasSessionRelativeTraversalSegment(spelling), true)
      await assert.rejects(
        () => createStudioWriteTool().execute({ path: spelling, content: 'x' }, context),
        (error: unknown) => error instanceof StudioWorkspaceWriteDeniedError && error.reason === 'traversal_target'
      )
      await assert.rejects(
        () => createStudioApplyPatchTool().execute({ path: spelling, patches: [{ search: 'a', replace: 'b' }] }, context),
        (error: unknown) => error instanceof StudioWorkspaceWriteDeniedError && error.reason === 'traversal_target'
      )
    }
  })

  await run('a symlink current source or symlink escape is denied', async () => {
    const fixture = await createFixture()
    const realDirectory = path.join(fixture.workspace, 'scenes', 'real')
    await mkdir(realDirectory, { recursive: true })
    const realSource = path.join(realDirectory, 'linked_source.py')
    await writeFile(realSource, '# real\n', 'utf8')
    const linkedSource = path.join(fixture.workspace, 'scenes', 'linked_source.py')
    await symlink(realSource, linkedSource, 'file')
    await fixture.persistence.sceneStore.create(createStudioScene({
      ownerId: fixture.session.ownerId,
      sessionId: fixture.session.id,
      id: 'scene_linked_source',
      position: 4,
      sourcePath: linkedSource
    }))

    // The preflight refuses to assemble a scope for a symlinked current source.
    await assert.rejects(
      () => loadScope(fixture, 'scene_linked_source'),
      (error: unknown) => error instanceof StudioRunExecutionScopeError && error.reason === 'unsafe_scene_source'
    )

    // The mutation layer independently denies the same target, so preflight and authorization
    // cannot drift: a scope assembled by hand for the symlink still refuses to write through it.
    const sourcedScope = createSceneRunExecutionScope({
      rootDirectory: fixture.workspace,
      sceneId: 'scene_linked_source',
      currentSourcePath: linkedSource,
      currentSourceRelativePath: 'scenes/linked_source.py',
      scenes: [],
      relativePath: 'scenes/linked_source.py'
    })
    const sourcedContext = toolContext({ session: fixture.session, run: runFor(fixture.session, { sceneId: 'scene_linked_source' }), executionScope: sourcedScope })
    await assert.rejects(
      () => createStudioWriteTool().execute({ path: 'scenes/linked_source.py', content: 'x' }, sourcedContext),
      (error: unknown) => error instanceof StudioWorkspaceWriteDeniedError && error.reason === 'symlink_target'
    )

    // In-workspace symlink ancestor: containment passes, the ancestor walk must still reject it.
    const linkedDirectory = path.join(fixture.workspace, 'scenes', 'linked_dir')
    await symlink(realDirectory, linkedDirectory, 'junction')
    const ancestorSource = path.join(linkedDirectory, 'ancestor.py')
    await writeFile(path.join(realDirectory, 'ancestor.py'), '# ancestor\n', 'utf8')
    await fixture.persistence.sceneStore.create(createStudioScene({
      ownerId: fixture.session.ownerId,
      sessionId: fixture.session.id,
      id: 'scene_linked_ancestor',
      position: 6,
      sourcePath: ancestorSource
    }))

    await assert.rejects(
      () => loadScope(fixture, 'scene_linked_ancestor'),
      (error: unknown) => error instanceof StudioRunExecutionScopeError && error.reason === 'unsafe_scene_source'
    )
    const ancestorScope = createSceneRunExecutionScope({
      rootDirectory: fixture.workspace,
      sceneId: 'scene_linked_ancestor',
      currentSourcePath: ancestorSource,
      currentSourceRelativePath: 'scenes/linked_dir/ancestor.py',
      scenes: [],
      relativePath: 'scenes/linked_dir/ancestor.py'
    })
    const ancestorContext = toolContext({ session: fixture.session, run: runFor(fixture.session, { sceneId: 'scene_linked_ancestor' }), executionScope: ancestorScope })
    await assert.rejects(
      () => createStudioWriteTool().execute({ path: 'scenes/linked_dir/ancestor.py', content: 'x' }, ancestorContext),
      (error: unknown) => error instanceof StudioWorkspaceWriteDeniedError && error.reason === 'symlink_ancestor'
    )
    assert.equal(await readFile(path.join(realDirectory, 'ancestor.py'), 'utf8'), '# ancestor\n')
  })

  await run('denial leaves current and sibling files byte-for-byte unchanged', async () => {
    const fixture = await createFixture()
    const scope = await loadScope(fixture, 'scene_0001')
    const context = toolContext({ session: fixture.session, run: runFor(fixture.session, { sceneId: 'scene_0001' }), executionScope: scope })
    const current = path.join(fixture.workspace, 'scenes', 'scene_0001.py')
    const sibling = path.join(fixture.workspace, 'scenes', 'scene_0002.py')
    const beforeCurrent = await readFile(current, 'utf8')
    const beforeSibling = await readFile(sibling, 'utf8')

    await assert.rejects(
      () => createStudioWriteTool().execute({ path: 'scenes/scene_0002.py', content: 'clobbered' }, context),
      (error: unknown) => error instanceof StudioWorkspaceWriteDeniedError
    )
    await assert.rejects(
      () => createStudioWriteTool().execute({ path: 'scenes/scene_0002.py', content: beforeCurrent }, context),
      (error: unknown) => error instanceof StudioWorkspaceWriteDeniedError
    )

    assert.equal(await readFile(current, 'utf8'), beforeCurrent)
    assert.equal(await readFile(sibling, 'utf8'), beforeSibling)
    assert.deepEqual(
      (await fixture.persistence.sceneStore.listBySessionId(fixture.session.ownerId, fixture.session.id)).map((scene) => scene.sourcePath).sort(),
      fixture.scenes.map((scene) => scene.sourcePath).sort()
    )
  })

  await run('denial metadata and model-visible error contain no absolute workspace path', async () => {
    const fixture = await createFixture()
    const scope = await loadScope(fixture, 'scene_0001')
    const context = toolContext({ session: fixture.session, run: runFor(fixture.session, { sceneId: 'scene_0001' }), executionScope: scope })

    let denial: StudioWorkspaceWriteDeniedError | null = null
    try {
      await createStudioWriteTool().execute({ path: 'scenes/scene_0000.py', content: 'x' }, context)
    } catch (error) {
      denial = error as StudioWorkspaceWriteDeniedError
    }

    assert.ok(denial)
    assert.equal(denial.targetPath, 'scenes/scene_0000.py')
    assert.equal(denial.reason, 'not_authorized_target')
    assert.equal(denial.message.includes(fixture.workspace), false)
    assert.equal(denial.message.includes('\\'), false)
  })

  await run('legacy write, edit and apply_patch remain session-wide', async () => {
    const fixture = await createFixture()
    const legacyScope = createLegacyRunExecutionScope({ rootDirectory: fixture.workspace })
    const context = toolContext({ session: fixture.session, run: runFor(fixture.session), executionScope: legacyScope })

    const created = await createStudioWriteTool().execute({ path: 'legacy/new_file.py', content: 'print(1)\n' }, context)
    assert.equal(created.metadata?.path, 'legacy/new_file.py')
    assert.equal(await readFile(path.join(fixture.workspace, 'legacy', 'new_file.py'), 'utf8'), 'print(1)\n')

    await createStudioEditTool().execute({ path: 'legacy/new_file.py', search: 'print(1)', replace: 'print(2)' }, context)
    assert.equal(await readFile(path.join(fixture.workspace, 'legacy', 'new_file.py'), 'utf8'), 'print(2)\n')

    await createStudioApplyPatchTool().execute({
      path: 'scenes/scene_0000.py',
      patches: [{ search: '# source of scene_0000', replace: '# legacy patched sibling' }]
    }, context)
    assert.equal(
      await readFile(path.join(fixture.workspace, 'scenes', 'scene_0000.py'), 'utf8'),
      '# legacy patched sibling\n'
    )
  })

  await run('exact-file policy objects are immutable snapshots', async () => {
    const fixture = await createFixture()
    const scope = await loadScope(fixture, 'scene_0001')
    assert.ok(scope.kind === 'scene')

    assert.ok(Object.isFrozen(scope))
    assert.ok(Object.isFrozen(scope.workspaceAccess))
    assert.ok(Object.isFrozen(scope.scenes))

    // A caller mutation cannot widen authority: it throws, or leaves the snapshot unchanged, and
    // a write at the widened path stays denied either way.
    try {
      ;(scope.workspaceAccess as { relativePath: string }).relativePath = 'scenes/scene_0000.py'
    } catch {
      // Strict mode rejects the write; that is the intended outcome.
    }

    const context = toolContext({ session: fixture.session, run: runFor(fixture.session, { sceneId: 'scene_0001' }), executionScope: scope })
    await assert.rejects(
      () => createStudioWriteTool().execute({ path: 'scenes/scene_0000.py', content: 'x' }, context),
      (error: unknown) => error instanceof StudioWorkspaceWriteDeniedError && error.reason === 'not_authorized_target'
    )
    const accepted = await createStudioWriteTool().execute({ path: 'scenes/scene_0001.py', content: '# still mine\n' }, context)
    assert.equal(accepted.metadata?.path, 'scenes/scene_0001.py')
  })

  // ------------------------------------------------------------------------- auto-render closure

  await run('scene auto-render reads the normalized successful Tool result path', async () => {
    const fixture = await createFixture({ studioKind: 'plot' })
    const sceneId = 'scene_0001'
    const renderPort = new RecordingPlotRenderPort()
    const registry = autoRenderRegistry(renderPort, stubMutationTool('write', 'scenes/scene_0001.py'))
    const model = new ScriptedStudioModel([
      toolCallCompletion('call-write', 'write', { path: path.join(fixture.workspace, 'scenes', 'scene_0001.py'), content: 'ignored' }),
      completion('done')
    ])
    const runner = sessionRunnerFor(fixture, registry)
    const handle = await runner.startBackgroundRun({
      projectId: PROJECT_ID,
      session: fixture.session,
      sceneId,
      inputText: 'draw',
      modelPort: model
    })
    await handle.completion

    assert.equal(renderPort.executed.length, 1)
    assert.equal(renderPort.executed[0]?.code, '# source of scene_0001\n')
    assert.equal(renderPort.executed[0]?.workspaceDirectory, fixture.workspace)
  })

  await run('a forged absolute raw argument cannot make auto-render read outside the workspace', async () => {
    const fixture = await createFixture({ studioKind: 'plot' })
    const outsideRoot = await mkdtemp(path.join(os.tmpdir(), 'manimcat-outside-render-'))
    const outsideFile = path.join(outsideRoot, 'secret.py')
    await writeFile(outsideFile, '# outside secret\n', 'utf8')

    const renderPort = new RecordingPlotRenderPort()
    // The Tool reports a trusted in-workspace path; the raw arguments name the outside file.
    const registry = autoRenderRegistry(renderPort, stubMutationTool('write', 'scenes/scene_0001.py'))
    const model = new ScriptedStudioModel([
      toolCallCompletion('call-forged', 'write', { path: outsideFile, content: 'x' }),
      completion('done')
    ])
    const handle = await sessionRunnerFor(fixture, registry).startBackgroundRun({
      projectId: PROJECT_ID,
      session: fixture.session,
      sceneId: 'scene_0001',
      inputText: 'draw',
      modelPort: model
    })
    await handle.completion

    assert.equal(renderPort.executed.length, 1)
    assert.equal(renderPort.executed[0]?.code, '# source of scene_0001\n')
    assert.equal(JSON.stringify(renderPort.executed).includes('outside secret'), false)

    // The same closure with the real write Tool: the absolute write is denied, so nothing renders.
    const deniedPort = new RecordingPlotRenderPort()
    const deniedRegistry = autoRenderRegistry(deniedPort, createStudioWriteTool())
    const deniedModel = new ScriptedStudioModel([
      toolCallCompletion('call-denied', 'write', { path: outsideFile, content: 'x' }),
      completion('done')
    ])
    const deniedHandle = await sessionRunnerFor(fixture, deniedRegistry).startBackgroundRun({
      projectId: PROJECT_ID,
      session: fixture.session,
      sceneId: 'scene_0001',
      inputText: 'draw',
      modelPort: deniedModel
    })
    await deniedHandle.completion

    assert.equal(deniedPort.executed.length, 0)
    assert.equal(await readFile(outsideFile, 'utf8'), '# outside secret\n')
  })

  await run('a missing or untrusted Tool result path skips auto-render', async () => {
    const fixture = await createFixture({ studioKind: 'plot' })
    const renderPort = new RecordingPlotRenderPort()
    const registry = autoRenderRegistry(renderPort, stubMutationTool('write', null))
    const model = new ScriptedStudioModel([
      toolCallCompletion('call-untrusted', 'write', { path: 'scenes/scene_0001.py' }),
      completion('done')
    ])
    const handle = await sessionRunnerFor(fixture, registry).startBackgroundRun({
      projectId: PROJECT_ID,
      session: fixture.session,
      sceneId: 'scene_0001',
      inputText: 'draw',
      modelPort: model
    })
    await handle.completion

    assert.equal(renderPort.executed.length, 0)
  })

  await run('scene auto-render accepts only the current source', async () => {
    const fixture = await createFixture({ studioKind: 'plot' })
    const renderPort = new RecordingPlotRenderPort()
    const registry = autoRenderRegistry(renderPort, stubMutationTool('write', 'scenes/scene_0000.py'))
    const model = new ScriptedStudioModel([
      toolCallCompletion('call-sibling', 'write', { path: 'scenes/scene_0000.py' }),
      completion('done')
    ])
    const handle = await sessionRunnerFor(fixture, registry).startBackgroundRun({
      projectId: PROJECT_ID,
      session: fixture.session,
      sceneId: 'scene_0001',
      inputText: 'draw',
      modelPort: model
    })
    await handle.completion

    assert.equal(renderPort.executed.length, 0)

    const acceptingPort = new RecordingPlotRenderPort()
    const acceptingRegistry = autoRenderRegistry(acceptingPort, stubMutationTool('write', 'scenes/scene_0001.py'))
    const acceptingModel = new ScriptedStudioModel([
      toolCallCompletion('call-current', 'write', { path: 'scenes/scene_0001.py' }),
      completion('done')
    ])
    const acceptedHandle = await sessionRunnerFor(fixture, acceptingRegistry).startBackgroundRun({
      projectId: PROJECT_ID,
      session: fixture.session,
      sceneId: 'scene_0001',
      inputText: 'draw',
      modelPort: acceptingModel
    })
    await acceptedHandle.completion
    assert.equal(acceptingPort.executed.length, 1)
  })

  await run('read, list and grep tools can still inspect a sibling scene source', async () => {
    const fixture = await createFixture()
    const scope = await loadScope(fixture, 'scene_0001')
    const context = toolContext({ session: fixture.session, run: runFor(fixture.session, { sceneId: 'scene_0001' }), executionScope: scope })

    const read = await createStudioReadTool().execute({ path: 'scenes/scene_0000.py' }, context)
    assert.ok(read.output.includes('source of scene_0000'))

    const listing = await createStudioLsTool().execute({ path: 'scenes' }, context)
    assert.ok(listing.output.includes('scene_0000.py'))
    assert.ok(listing.output.includes('scene_0001.py'))

    const glob = await createStudioGlobTool().execute({ pattern: 'scenes/*.py' }, context)
    assert.ok(glob.output.includes('scenes/scene_0000.py'))

    const grep = await createStudioGrepTool().execute({ pattern: 'source of scene_0000', path: 'scenes' }, context)
    assert.ok(grep.output.includes('scene_0000.py'))
  })

  await run('static-check reads a sibling scene source while the write boundary stays exact-file', async () => {
    const fixture = await createFixture()
    const scope = await loadScope(fixture, 'scene_0001')
    const context = toolContext({ session: fixture.session, run: runFor(fixture.session, { sceneId: 'scene_0001' }), executionScope: scope })
    const port = new RecordingStaticCheckPort()

    const checked = await createStudioStaticCheckTool(port).execute({ path: 'scenes/scene_0000.py' }, context)
    assert.equal(port.checked.length, 1)
    assert.equal(port.checked[0]?.kind, 'manim')
    assert.ok(port.checked[0]?.code.includes('source of scene_0000'))
    assert.equal(checked.metadata?.path, 'scenes/scene_0000.py')
    assert.equal(checked.metadata?.diagnosticCount, 0)

    // Reading a neighbour never widens the write authority of the same Tool context.
    await assert.rejects(
      () => createStudioWriteTool().execute({ path: 'scenes/scene_0000.py', content: 'x' }, context),
      (error: unknown) => error instanceof StudioWorkspaceWriteDeniedError && error.reason === 'not_authorized_target'
    )
    assert.equal(await readFile(path.join(fixture.workspace, 'scenes', 'scene_0000.py'), 'utf8'), '# source of scene_0000\n')
  })

  await run('trusted plot render output paths remain unaffected by the generic write policy', async () => {
    const fixture = await createFixture({ studioKind: 'plot' })
    const renderPort = new RecordingPlotRenderPort()
    const registry = configureStudioToolRegistry({ registry: new StudioToolRegistry(), plotRenderPort: renderPort })
    const model = new ScriptedStudioModel([completion('rendered')])
    const handle = await sessionRunnerFor(fixture, registry).startBackgroundRun({
      projectId: PROJECT_ID,
      session: fixture.session,
      sceneId: 'scene_0001',
      inputText: 'render it',
      modelPort: model
    })
    await handle.completion

    // The Run itself does not render without a tool call, so render directly through the Tool with
    // the same scope: the Port may write wherever it wants, outside the exact-file write policy.
    const scope = await loadScope(fixture, 'scene_0001')
    const context = toolContext({ session: fixture.session, run: runFor(fixture.session, { sceneId: 'scene_0001' }), executionScope: scope })
    const renderTool = registry.require('render', 'plot')
    const rendered = await renderTool.execute({ concept: 'fixture plot', code: 'print("plot")\n' }, context)

    assert.equal(renderPort.executed.length, 1)
    assert.equal(renderPort.executed[0]?.code, 'print("plot")\n')
    assert.equal(renderPort.executed[0]?.workspaceDirectory, fixture.workspace)
    assert.ok(rendered.metadata?.scriptPath)
    assert.equal(String(rendered.metadata?.scriptPath).includes(fixture.workspace), false)
    const renders = await fixture.persistence.renderStore.listBySceneId(OWNER_ID, 'scene_0001')
    assert.equal(renders.length, 1)
    assert.equal(renders[0]?.sceneId, 'scene_0001')
    assert.equal(String(renders[0]?.metadata?.scriptPath).includes(fixture.workspace), false)
  })

  await run('the Manim render Tool keeps Session workspace authority while generic mutation stays exact-file', async () => {
    const fixture = await createFixture({ studioKind: 'manim' })
    const renderPort = new RecordingManimRenderPort()
    const scope = await loadScope(fixture, 'scene_0001')
    const context = toolContext({ session: fixture.session, run: runFor(fixture.session, { sceneId: 'scene_0001' }), executionScope: scope })

    const rendered = await createStudioRenderTool(renderPort).execute(
      { concept: 'fixture manim', code: 'print("manim")\n' },
      context
    )

    // The Render Port is not the generic write policy: it keeps the Session workspace and the code
    // the Tool submitted, while the Run scope still stamps the created render.
    assert.equal(renderPort.submitted.length, 1)
    assert.equal(renderPort.submitted[0]?.workspaceDirectory, fixture.workspace)
    assert.equal(renderPort.submitted[0]?.code, 'print("manim")\n')
    assert.equal(rendered.metadata?.outputMode, 'video')
    const renders = await fixture.persistence.renderStore.listBySceneId(OWNER_ID, 'scene_0001')
    assert.equal(renders.length, 1)
    assert.equal(renders[0]?.sceneId, 'scene_0001')

    // Generic mutation of the same context remains bound to the current Scene source.
    await assert.rejects(
      () => createStudioWriteTool().execute({ path: 'scenes/scene_0000.py', content: 'x' }, context),
      (error: unknown) => error instanceof StudioWorkspaceWriteDeniedError && error.reason === 'not_authorized_target'
    )
    await assert.rejects(
      () => createStudioWriteTool().execute({ path: 'outputs/manim.py', content: 'x' }, context),
      (error: unknown) => error instanceof StudioWorkspaceWriteDeniedError && error.reason === 'not_authorized_target'
    )
  })

  await run('the Tool context of scene A cannot mutate scene B while both runs execute concurrently', async () => {
    const fixture = await createFixture()
    const scopeA = await loadScope(fixture, 'scene_0001')
    const scopeB = await loadScope(fixture, 'scene_0000')
    const contextA = toolContext({ session: fixture.session, run: runFor(fixture.session, { sceneId: 'scene_0001' }), executionScope: scopeA })
    const contextB = toolContext({ session: fixture.session, run: runFor(fixture.session, { sceneId: 'scene_0000' }), executionScope: scopeB })
    const writeTool = createStudioWriteTool()

    const results = await Promise.allSettled([
      writeTool.execute({ path: 'scenes/scene_0001.py', content: '# A own\n' }, contextA),
      writeTool.execute({ path: 'scenes/scene_0000.py', content: '# B own\n' }, contextB),
      writeTool.execute({ path: 'scenes/scene_0000.py', content: '# A tries B\n' }, contextA),
      writeTool.execute({ path: 'scenes/scene_0001.py', content: '# B tries A\n' }, contextB)
    ])

    assert.deepEqual(results.map((result) => result.status), ['fulfilled', 'fulfilled', 'rejected', 'rejected'])
    assert.equal(await readFile(path.join(fixture.workspace, 'scenes', 'scene_0001.py'), 'utf8'), '# A own\n')
    assert.equal(await readFile(path.join(fixture.workspace, 'scenes', 'scene_0000.py'), 'utf8'), '# B own\n')
  })

  await run('every Tool call of a Run receives an explicit execution scope from the runtime', async () => {
    const fixture = await createFixture()
    const captured: Array<StudioRunExecutionScope | undefined> = []
    const captureTool: StudioToolDefinition = {
      name: 'capture',
      parameters: { type: 'object', properties: {}, required: [] } as never,
      description: 'capture the Tool context scope',
      allowedAgents: ['builder'],
      execute: async (_input, context): Promise<StudioToolResult> => {
        captured.push(context.executionScope)
        return { title: 'captured', output: 'ok' }
      }
    }
    const registry = new StudioToolRegistry()
    registry.register(captureTool)

    const sceneModel = new ScriptedStudioModel([
      toolCallCompletion('call-scope', 'capture', {}),
      completion('done')
    ])
    await (await sessionRunnerFor(fixture, registry).startBackgroundRun({
      projectId: PROJECT_ID,
      session: fixture.session,
      sceneId: 'scene_0001',
      inputText: 'draw',
      modelPort: sceneModel
    })).completion

    const legacyModel = new ScriptedStudioModel([
      toolCallCompletion('call-scope-legacy', 'capture', {}),
      completion('done')
    ])
    await (await sessionRunnerFor(fixture, registry).startBackgroundRun({
      projectId: PROJECT_ID,
      session: fixture.session,
      inputText: 'draw',
      modelPort: legacyModel
    })).completion

    const sceneScope = captured[0]
    const legacyScope = captured[1]
    assert.ok(sceneScope)
    assert.equal(sceneScope.kind, 'scene')
    assert.ok(sceneScope.kind === 'scene')
    assert.equal(sceneScope.sceneId, 'scene_0001')
    assert.deepEqual(sceneScope.workspaceAccess, { write: 'exact-file', relativePath: 'scenes/scene_0001.py' })
    assert.ok(legacyScope)
    assert.equal(legacyScope.kind, 'legacy-session')
    assert.deepEqual(legacyScope.workspaceAccess, { write: 'session-workspace' })
  })

  await run('no mutating Tool can reach a session-wide write policy implicitly', async () => {
    const toolSources = await Promise.all([
      readFile(path.join(process.cwd(), 'src/studio-agent/tools/write-tool.ts'), 'utf8'),
      readFile(path.join(process.cwd(), 'src/studio-agent/tools/edit-tool.ts'), 'utf8'),
      readFile(path.join(process.cwd(), 'src/studio-agent/tools/apply-patch-tool.ts'), 'utf8')
    ])
    for (const source of toolSources) {
      assert.equal(source.includes('executionScope?.'), false)
      assert.ok(source.includes('access: context.executionScope.workspaceAccess'))
    }

    const policySources = await Promise.all([
      readFile(path.join(process.cwd(), 'src/studio-agent/tools/workspace-edits.ts'), 'utf8'),
      readFile(path.join(process.cwd(), 'src/studio-agent/tools/workspace-access-policy.ts'), 'utf8')
    ])
    for (const source of policySources) {
      assert.equal(source.includes('STUDIO_WORKSPACE_WRITE_DEFAULT_POLICY'), false)
      assert.equal(source.includes('access?:'), false)
      assert.equal(source.includes('access ??'), false)
    }
  })

  await run('scope helpers normalize, order and reject session-relative paths deterministically', async () => {
    const fixture = await createFixture()
    const scope = await loadScope(fixture, 'scene_0001')
    assert.ok(scope.kind === 'scene')

    assert.deepEqual(
      truncateSceneDirectory(scope.scenes).entries.map((entry) => entry.id),
      ['scene_0001', 'scene_0000', 'scene_0002']
    )
    const zero = truncateSceneDirectory(scope.scenes, 0)
    assert.deepEqual(zero.entries, [])
    assert.equal(zero.truncated, true)
    assert.equal(zero.omittedCount, 3)

    // The centralized selector never infers scope from message metadata.
    const legacyRun = runFor(fixture.session)
    const sceneRun = runFor(fixture.session, { sceneId: 'scene_0001' })
    assert.equal(legacyRun.sceneId, undefined)
    assert.equal(sceneRun.sceneId, 'scene_0001')
  })
}
