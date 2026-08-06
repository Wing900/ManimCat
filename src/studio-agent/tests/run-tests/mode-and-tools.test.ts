import assert from 'node:assert/strict'
import {
  createStudioAssistantMessage,
  createInMemoryStudioPersistence,
  createLocalStudioBlobStore,
  createLocalStudioWorkspaceProvider,
  createStudioRenderTool,
  createStudioRun,
  createStudioSession,
  createStudioRuntimeService,
  defaultRulesForLevel,
  InMemoryStudioEventBus,
  InMemoryStudioTaskStore,
  InMemoryStudioWorkResultStore,
  InMemoryStudioWorkStore,
  InMemoryStudioRenderStore,
  type ManimRenderSubmissionInput,
  type PlotRenderExecution,
  type StudioRuntimeBackedToolContext
} from '../../index'
import { createWorkspace, run } from './factories'
import { getStudioModeDefinition } from '../../modes/studio-mode'
import { createSharedStudioTools } from '../../shared/register-shared-tools'
import { createPlotStudioRenderTool } from '../../plot/tools/plot-render-tool'

function createToolContext(studioKind: 'manim' | 'plot'): StudioRuntimeBackedToolContext {
  const session = createStudioSession({
    ownerId: 'owner-test',
    projectId: 'project-1',
    studioKind,
    agentType: 'builder',
    title: `${studioKind} test session`,
    directory: `/workspace/${studioKind}`,
    permissionLevel: 'L4',
    permissionRules: defaultRulesForLevel('L4')
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
    taskStore: new InMemoryStudioTaskStore(),
    workStore: new InMemoryStudioWorkStore(),
    workResultStore: new InMemoryStudioWorkResultStore()
    ,renderStore: new InMemoryStudioRenderStore()
  }
}

export async function runModeAndToolTests(): Promise<void> {
  await run('runtime owns session snapshot assembly', async () => {
    const service = createStudioRuntimeService({
      persistence: createInMemoryStudioPersistence(),
      workspaceProvider: createLocalStudioWorkspaceProvider(),
      blobStore: createLocalStudioBlobStore()
    })
    const session = await service.createSession({
      ownerId: 'owner-test',
      projectId: 'project-1',
      directory: await createWorkspace(),
      useDedicatedWorkspace: false,
      studioKind: 'plot',
      agentType: 'builder'
    })

    const snapshot = await service.getSessionSnapshot(session.ownerId, session.id)
    assert.ok(snapshot)
    assert.equal(snapshot.session.id, session.id)
    assert.deepEqual(snapshot.tasks, [])
    assert.deepEqual(await service.getSessionTasks(session.ownerId, session.id), [])
    assert.deepEqual((await service.getSessionWorkSnapshot(session.ownerId, session.id))?.works, [])
    assert.equal(await service.getSessionSnapshot(session.ownerId, 'missing-session'), null)
    assert.equal(await service.getRun(session.ownerId, 'missing-run'), null)
  })

  await run('studio modes own their automatic render policy', async () => {
    assert.deepEqual(getStudioModeDefinition('manim').autoRenderAfterTools, [])
    assert.deepEqual(getStudioModeDefinition('plot').autoRenderAfterTools, [
      'write',
      'edit',
      'apply_patch'
    ])
  })

  await run('shared tool set excludes question interaction', async () => {
    const toolNames = createSharedStudioTools().map((tool) => tool.name)
    assert.deepEqual(toolNames, [
      'read',
      'glob',
      'grep',
      'ls',
      'write',
      'edit',
      'apply_patch',
      'static-check'
    ])
  })

  await run('Manim render tool uses an injected render port', async () => {
    const calls: ManimRenderSubmissionInput[] = []
    const tool = createStudioRenderTool({
      async submit(input) {
        calls.push(input)
        return { jobId: input.jobId }
      }
    })
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
      async listBySessionId(ownerId, sessionId) {
        return renderStore.listBySessionId(ownerId, sessionId)
      },
    }
    const tool = createStudioRenderTool({
      async submit() {
        order.push('submit')
        throw new Error('queue unavailable')
      }
    })

    await assert.rejects(() => tool.execute({ concept: 'broken queue', code: 'class Scene: pass' }, context), /queue unavailable/)
    assert.deepEqual(order, ['create', 'submit', 'update:failed'])
    const renders = await renderStore.listBySessionId(context.session.ownerId, context.session.id)
    assert.equal(renders[0]?.status, 'failed')
  })

  await run('Plot render tool uses an injected render port', async () => {
    const execution: PlotRenderExecution = {
      outputDir: '/workspace/plot/renders/plot-test',
      scriptPath: '/workspace/plot/renders/plot-test/plot_script.py',
      imageDataUris: ['data:image/png;base64,test'],
      imagePaths: ['/workspace/plot/renders/plot-test/plot_1.png'],
      stdout: 'ok',
      stderr: ''
    }
    let receivedCode = ''
    const tool = createPlotStudioRenderTool({
      async execute(input) {
        receivedCode = input.code
        return execution
      }
    })
    const context = createToolContext('plot')

    const result = await tool.execute({
      concept: 'A test plot',
      code: 'import matplotlib.pyplot as plt'
    }, context)

    assert.equal(receivedCode, 'import matplotlib.pyplot as plt')
    assert.equal(result.metadata?.imageCount, 1)
    assert.equal(result.attachments?.[0]?.mimeType, 'image/png')
  })
}
