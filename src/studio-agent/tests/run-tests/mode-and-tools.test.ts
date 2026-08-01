import assert from 'node:assert/strict'
import {
  createStudioAssistantMessage,
  createStudioRenderTool,
  createStudioRun,
  createStudioSession,
  defaultRulesForLevel,
  InMemoryStudioEventBus,
  InMemoryStudioTaskStore,
  InMemoryStudioWorkResultStore,
  InMemoryStudioWorkStore,
  type ManimRenderSubmissionInput,
  type PlotRenderExecution,
  type StudioRuntimeBackedToolContext
} from '../../index'
import { run } from './factories'
import { createSharedStudioTools } from '../../shared/register-shared-tools'
import { createPlotStudioRenderTool } from '../../plot/tools/plot-render-tool'

function createToolContext(studioKind: 'manim' | 'plot'): StudioRuntimeBackedToolContext {
  const session = createStudioSession({
    projectId: 'project-1',
    studioKind,
    agentType: 'builder',
    title: `${studioKind} test session`,
    directory: `/workspace/${studioKind}`,
    permissionLevel: 'L4',
    permissionRules: defaultRulesForLevel('L4')
  })
  const runRecord = createStudioRun({
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
  }
}

export async function runModeAndToolTests(): Promise<void> {
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
