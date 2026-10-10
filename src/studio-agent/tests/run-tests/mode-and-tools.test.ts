import type { StudioKind } from '../../domain/core-types'
import assert from 'node:assert/strict'
import {
  createLegacyRunExecutionScope,
  createStudioAssistantMessage,
  buildStudioRenderContext,
  createInMemoryStudioPersistence,
  createLocalStudioWorkspaceProvider,
  createManimStudioRenderTool,
  createPlotStudioRenderTool,
  createManimRenderDriver,
  createMatplotlibRenderDriver,
  createUnavailableStudioRenderResultPort,
  createManimMode,
  createMatplotlibMode,
  createStudioRender,
  createStudioRun,
  createStudioSession,
  InMemoryStudioEventBus,
  InMemoryStudioRenderStore,
  type ManimRenderSubmissionInput,
  type PlotRenderExecution,
  type StudioRuntimeBackedToolContext
} from '../../index'
import { createWorkspace, run } from './factories'
import { createTestStudioRuntime } from './factories'
import { RecordingEventBus } from '../support/recording-event-bus'
import { adaptStudioEvent } from '../../infrastructure/events/studio-event-adapter'
import { getStudioModeDefinition } from '../../modes/studio-mode'
import { createSharedStudioTools } from '../../shared/register-shared-tools'
import { getApiRagService } from '../../../knowledge/api-rag'

function createToolContext(studioKind: StudioKind): StudioRuntimeBackedToolContext {
  const session = createStudioSession({
    ownerId: 'owner-test',
    projectId: 'project-1',
    studioKind,
    agentType: 'builder',
    title: `${studioKind} test session`,
    directory: `/workspace/${studioKind}`
  })
  const runRecord = createStudioRun({
    ownerId: session.ownerId,
    sessionId: session.id,
    inputText: 'create a test output',
    activeAgent: 'builder'
  })

  return {
    projectId: session.projectId,
    session,
    run: runRecord,
    assistantMessage: createStudioAssistantMessage({
      sessionId: session.id,
      agent: 'builder'
    }),
    eventBus: new InMemoryStudioEventBus(),
    renderStore: new InMemoryStudioRenderStore(),
    executionScope: createLegacyRunExecutionScope({ rootDirectory: session.directory })
  }
}

export async function runModeAndToolTests(): Promise<void> {
  await run('runtime owns session snapshot assembly', async () => {
    const service = createTestStudioRuntime({
      persistence: createInMemoryStudioPersistence(),
      workspaceProvider: createLocalStudioWorkspaceProvider()
    })
    const session = await service.createSession({
      ownerId: 'owner-test',
      projectId: 'project-1',
      directory: await createWorkspace(),
      useDedicatedWorkspace: false,
      studioKind: 'matplotlib',
      agentType: 'builder'
    })

    const snapshot = await service.getSessionSnapshot(session.ownerId, session.id)
    assert.ok(snapshot)
    assert.equal(snapshot.session.id, session.id)
    assert.deepEqual(snapshot.renders, [])
    assert.equal(await service.getSessionSnapshot(session.ownerId, 'missing-session'), null)
    assert.equal(await service.getRun(session.ownerId, 'missing-run'), null)
  })

  await run('render context selects the latest render for the owner', async () => {
    const session = createStudioSession({
      ownerId: 'owner-context',
      projectId: 'project-1',
      studioKind: 'matplotlib',
      agentType: 'builder',
      title: 'Render context',
      directory: '/workspace/plot'
    })
    const renderStore = new InMemoryStudioRenderStore()
    const older = createStudioRender({
      ownerId: session.ownerId,
      sessionId: session.id,
      kind: 'matplotlib',
      title: 'Older',
      concept: 'older',
      outputMode: 'image',
      status: 'completed'
    })
    older.updatedAt = '2026-01-01T00:00:00.000Z'
    const latest = createStudioRender({
      ownerId: session.ownerId,
      sessionId: session.id,
      kind: 'matplotlib',
      title: 'Latest',
      concept: 'latest',
      outputMode: 'image',
      status: 'failed',
      error: 'plot failed'
    })
    latest.updatedAt = '2026-01-02T00:00:00.000Z'
    const otherOwnerRender = createStudioRender({
      ownerId: 'owner-other',
      sessionId: session.id,
      kind: 'matplotlib',
      title: 'Hidden',
      concept: 'hidden',
      outputMode: 'image',
      status: 'completed'
    })
    otherOwnerRender.updatedAt = '2026-01-03T00:00:00.000Z'
    await renderStore.create(older)
    await renderStore.create(latest)
    await renderStore.create(otherOwnerRender)

    const context = await buildStudioRenderContext({
      ownerId: session.ownerId,
      sessionId: session.id,
      agent: session.agentType,
      renderStore
    })

    assert.equal(context.latestRender?.id, latest.id)
    assert.equal(context.latestRender?.status, 'failed')
    assert.equal(context.latestRender?.error, 'plot failed')
  })

  await run('studio modes differ only in scene facts, never in render behavior', async () => {
    // No Mode renders on its own: the Builder calls the `render` Tool for both kinds.
    const manim = getStudioModeDefinition('manim')
    const plot = getStudioModeDefinition('matplotlib')
    assert.deepEqual(Object.keys(manim).sort(), [
      'codeLanguage',
      'kind',
      'label',
      'outputModes',
      'runtimeSummary'
    ])
    assert.deepEqual(Object.keys(plot).sort(), Object.keys(manim).sort())
    assert.deepEqual(manim.outputModes, ['video', 'image'])
    assert.deepEqual(plot.outputModes, ['image'])
    assert.notEqual(manim.codeLanguage, plot.codeLanguage)
  })

  await run('shared tool set excludes question interaction and registers one search_api per ready package', async () => {
    const bare = createSharedStudioTools().map((tool) => tool.name)
    assert.deepEqual(bare, ['read', 'glob', 'grep', 'ls', 'write', 'edit'])

    // Every registered package owns one Studio kind: manim for scenes, plot for figures.
    const modes = [
      createManimMode(createManimRenderDriver({
        renderPort: { submit: async ({ jobId }) => ({ jobId }) },
        resultPort: createUnavailableStudioRenderResultPort()
      })),
      createMatplotlibMode(createMatplotlibRenderDriver({
        renderPort: { execute: async () => ({ outputDir: '', scriptPath: '', imageDataUris: [], imagePaths: [], stdout: '', stderr: '' }) }
      })),
    ]
    const tools = createSharedStudioTools({ apiRagService: getApiRagService(), modes })
    const searchTools = tools.filter((tool) => tool.name === 'search_api')
    assert.deepEqual(searchTools.map((tool) => tool.allowedStudioKinds), [['manim'], ['matplotlib']])
    assert.ok(searchTools.every((tool) => tool.allowedAgents.includes('builder')))
  })

  await run('Manim render tool uses an injected render port', async () => {
    const calls: ManimRenderSubmissionInput[] = []
    const tool = createManimStudioRenderTool(
      createManimRenderDriver({
        renderPort: {
          async submit(input) {
            calls.push(input)
            return { jobId: input.jobId }
          }
        },
        resultPort: createUnavailableStudioRenderResultPort()
      })
    )
    const context = createToolContext('manim')

    const result = await tool.execute({
      concept: 'A test scene',
      code: 'class MainScene(Scene): pass',
      outputMode: 'video',
      quality: 'low'
    }, context)

    assert.equal(calls.length, 1)
    assert.equal(calls[0]?.workspaceDirectory, context.session.directory)
    assert.equal(calls[0]?.code, 'class MainScene(Scene): pass')
    assert.equal(result.metadata?.jobId, calls[0]?.jobId)
  })

  await run('Manim render persists before queue submission and records failure', async () => {
    const order: string[] = []
    const renderStore = new InMemoryStudioRenderStore()
    const context = createToolContext('manim')
    const eventBus = new RecordingEventBus()
    context.eventBus = eventBus
    context.renderStore = {
      async create(render) {
        order.push('create')
        return renderStore.create(render)
      },
      async getById(ownerId, renderId) {
        return renderStore.getById(ownerId, renderId)
      },
      async update(ownerId, renderId, patch) {
        order.push(`update:${patch.status ?? 'unknown'}`)
        return renderStore.update(ownerId, renderId, patch)
      },
      async transitionStatus(input) {
        order.push(`transition:${input.patch.status}`)
        return renderStore.transitionStatus(input)
      },
      async listBySessionId(ownerId, sessionId) {
        return renderStore.listBySessionId(ownerId, sessionId)
      },
      async listBySceneId(ownerId, sceneId) {
        return renderStore.listBySceneId(ownerId, sceneId)
      },
    }
    const tool = createManimStudioRenderTool(
      createManimRenderDriver({
        renderPort: {
          async submit() {
            order.push('submit')
            throw new Error('queue unavailable')
          }
        },
        resultPort: createUnavailableStudioRenderResultPort()
      })
    )

    await assert.rejects(() => tool.execute({ concept: 'broken queue', code: 'class Scene: pass' }, context), /queue unavailable/)
    assert.deepEqual(order, ['create', 'submit', 'transition:failed'])
    const renders = await renderStore.listBySessionId(context.session.ownerId, context.session.id)
    assert.equal(renders[0]?.status, 'failed')
    assert.deepEqual(eventBus.events.filter((event) => event.type === 'render_updated').map((event) => event.render.status), [
      'queued',
      'failed'
    ])
  })

  await run('Plot render tool uses an injected render port', async () => {
    const execution: PlotRenderExecution = {
      outputDir: '/workspace/matplotlib/renders/plot-test',
      scriptPath: '/workspace/matplotlib/renders/plot-test/plot_script.py',
      imageDataUris: ['data:image/png;base64,test'],
      imagePaths: ['/workspace/matplotlib/renders/plot-test/plot_1.png'],
      stdout: 'ok',
      stderr: ''
    }
    let receivedCode = ''
    const tool = createPlotStudioRenderTool(
      createMatplotlibRenderDriver({
        renderPort: {
          async execute(input) {
            receivedCode = input.code
            return execution
          }
        }
      })
    )
    const context = createToolContext('matplotlib')
    const eventBus = new RecordingEventBus()
    context.eventBus = eventBus

    const result = await tool.execute({
      concept: 'A test plot',
      code: 'import matplotlib.pyplot as plt'
    }, context)

    assert.equal(receivedCode, 'import matplotlib.pyplot as plt')
    assert.equal(result.metadata?.imageCount, 1)
    assert.equal(result.attachments?.[0]?.mimeType, 'image/png')
    const renders = await context.renderStore?.listBySessionId(context.session.ownerId, context.session.id)
    assert.equal(renders?.[0]?.status, 'completed')
    assert.equal(renders?.[0]?.metadata?.scriptPath, 'renders/plot-test/plot_script.py')
    const renderEvents = eventBus.events.filter((event) => event.type === 'render_updated')
    assert.deepEqual(renderEvents.map((event) => event.render.status), ['running', 'completed'])
    const externalEvent = adaptStudioEvent(renderEvents.at(-1)!)
    assert.equal(externalEvent?.type, 'render.updated')
    assert.equal(externalEvent?.properties.sessionId, context.session.id)
  })
}
