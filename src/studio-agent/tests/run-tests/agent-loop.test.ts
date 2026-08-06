import assert from 'node:assert/strict'
import {
  createInMemoryStudioPersistence,
  createStudioAssistantMessage,
  createStudioRun,
  createStudioSession,
  InMemoryStudioEventBus,
  StudioToolRegistry,
} from '../../index'
import { createStudioOpenAIToolLoop } from '../../orchestration/openai-tool-loop/controller'
import { createSharedStudioTools } from '../../shared/register-shared-tools'
import { ScriptedStudioModel } from '../support/scripted-studio-model'
import { run } from './factories'

export async function runAgentLoopTests(): Promise<void> {
  await run('agent loop accepts an injected scripted model', async () => {
    const persistence = createInMemoryStudioPersistence()
    const session = createStudioSession({
      ownerId: 'owner-loop',
      projectId: 'project-loop',
      agentType: 'builder',
      title: 'Loop test',
      directory: 'workspace-loop',
      permissionLevel: 'L4',
    })
    const runRecord = createStudioRun({
      ownerId: session.ownerId,
      sessionId: session.id,
      inputText: 'say hello',
      activeAgent: 'builder',
    })
    const assistantMessage = createStudioAssistantMessage({
      sessionId: session.id,
      agent: 'builder',
    })
    await persistence.sessionStore.create(session)
    await persistence.runStore.create(runRecord)
    await persistence.messageStore.createAssistantMessage(assistantMessage)

    const registry = new StudioToolRegistry()
    for (const tool of createSharedStudioTools()) {
      registry.register(tool)
    }
    const model = new ScriptedStudioModel([{
      id: 'completion-1',
      object: 'chat.completion',
      created: Date.now(),
      model: 'scripted',
      choices: [{
        index: 0,
        finish_reason: 'stop',
        message: { role: 'assistant', content: 'hello from scripted model' },
      }],
    } as any])
    const events = [...(await collect(createStudioOpenAIToolLoop({
      projectId: session.projectId,
      session,
      run: runRecord,
      assistantMessage,
      inputText: runRecord.inputText,
      messageStore: persistence.messageStore,
      partStore: persistence.partStore,
      registry,
      eventBus: new InMemoryStudioEventBus(),
      renderStore: persistence.renderStore,
      documentationContext: 'Manim parameter reference: use Axes for coordinate plots.',
      modelPort: model,
      createAssistantMessage: async () => assistantMessage,
      setToolMetadata: () => undefined,
      maxSteps: 2,
    })))]

    assert.equal(model.requests.length, 1)
    assert.equal(events.some((event) => event.type === 'text-delta' && event.text.includes('hello')), true)
    assert.equal(model.requests[0]?.messages[0]?.role, 'system')
    assert.match(String(model.requests[0]?.messages[0]?.content), /Manim parameter reference/)
  })
}

async function collect<T>(source: AsyncIterable<T>): Promise<T[]> {
  const values: T[] = []
  for await (const value of source) {
    values.push(value)
  }
  return values
}
