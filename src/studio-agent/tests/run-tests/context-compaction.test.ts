import assert from 'node:assert/strict'
import type OpenAI from 'openai'
import { createInMemoryStudioPersistence } from '../../infrastructure/persistence/in-memory-studio-persistence'
import {
  createStudioAssistantMessage,
  createStudioRun,
  createStudioSession,
  createStudioUserMessage
} from '../../domain/factories'
import { createLegacyRunExecutionScope } from '../../domain/run-execution-scope'
import {
  buildStudioCompactionSummaryPrompt,
  findLatestStudioCompaction,
  readStudioCompactionMetadata,
  selectStudioCompactionPlan,
  selectStudioStoredConversation,
  truncateStudioToolOutputsForSummary
} from '../../context/compaction'
import {
  calibrateStudioTokenRatio,
  readStudioContextConfig,
  readStudioContextLimit,
  shouldCompactStudioContext
} from '../../context/context-budget'
import { isStudioContextOverflowError } from '../../context/context-overflow'
import { createStudioLoopRuntime } from '../../orchestration/openai-tool-loop/request-builder'
import { createStudioOpenAIToolLoop } from '../../orchestration/openai-tool-loop/controller'
import { InMemoryStudioEventBus, StudioToolRegistry } from '../../index'
import type { StudioModelPort, StudioModelRequest, StudioModelResponse } from '../../model/studio-model-port'
import { run } from './factories'

function completion(
  content: string,
  usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number }
): StudioModelResponse {
  return {
    id: 'completion-context',
    object: 'chat.completion',
    created: Date.now(),
    model: 'scripted',
    choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content } }],
    usage
  } as StudioModelResponse
}

function providerMessage(_id: string, role: 'user' | 'assistant', content: string): OpenAI.Chat.Completions.ChatCompletionMessageParam {
  return { role, content, ...(role === 'assistant' ? {} : {}) } as OpenAI.Chat.Completions.ChatCompletionMessageParam
}

async function collect<T>(source: AsyncIterable<T>): Promise<T[]> {
  const values: T[] = []
  for await (const value of source) values.push(value)
  return values
}

export async function runContextCompactionTests(): Promise<void> {
  await run('context threshold is window minus reserve, not the raw window', async () => {
    const config = readStudioContextConfig({
      STUDIO_CONTEXT_WINDOW_TOKENS: '1000',
      STUDIO_CONTEXT_RESERVE_TOKENS: '200',
      STUDIO_CONTEXT_KEEP_RECENT_TOKENS: '400',
      STUDIO_CONTEXT_COMPACTION_ENABLED: 'true'
    } as NodeJS.ProcessEnv)
    assert.equal(readStudioContextLimit(config), 800)

    assert.equal(shouldCompactStudioContext({
      config,
      systemPrompt: '',
      messages: [providerMessage('m', 'user', 'x'.repeat(3000))],
      tools: []
    }), false)
    assert.equal(shouldCompactStudioContext({
      config,
      systemPrompt: '',
      messages: [providerMessage('m', 'user', 'x'.repeat(4000))],
      tools: []
    }), true)

    const disabled = readStudioContextConfig({
      STUDIO_CONTEXT_WINDOW_TOKENS: '1000',
      STUDIO_CONTEXT_RESERVE_TOKENS: '200',
      STUDIO_CONTEXT_COMPACTION_ENABLED: 'false'
    } as NodeJS.ProcessEnv)
    assert.equal(shouldCompactStudioContext({
      config: disabled,
      systemPrompt: '',
      messages: [providerMessage('m', 'user', 'x'.repeat(4000))],
      tools: []
    }), false)
  })

  await run('calibration keeps the current ratio when actual equals the already-calibrated estimate', async () => {
    // estimatedTokens already includes currentRatio, so observed 200/200 = 1 leaves the ratio at 2.
    assert.equal(calibrateStudioTokenRatio({
      estimatedTokens: 200,
      actualPromptTokens: 200,
      currentRatio: 2
    }), 2)
  })

  await run('summary plus recent boundary ignores compaction records and leaves history untouched', async () => {
    const m1 = createStudioUserMessage({ sessionId: 'sess_ctx', sceneId: 'scene_ctx', text: 'old ask' })
    const m2 = createStudioAssistantMessage({ sessionId: 'sess_ctx', sceneId: 'scene_ctx', agent: 'builder' })
    m2.parts = [{ id: 'p2', messageId: m2.id, sessionId: 'sess_ctx', type: 'text', text: 'old answer' }]
    const record = createStudioAssistantMessage({
      sessionId: 'sess_ctx',
      sceneId: 'scene_ctx',
      agent: 'builder',
      metadata: { compaction: { firstKeptMessageId: 'kept_m4', tokensBefore: 900, model: 'm' } }
    })
    record.summary = 'SUMMARY TEXT'
    const m4 = createStudioUserMessage({ sessionId: 'sess_ctx', sceneId: 'scene_ctx', text: 'recent ask' })
    m4.id = 'kept_m4'
    const m5 = createStudioAssistantMessage({ sessionId: 'sess_ctx', sceneId: 'scene_ctx', agent: 'builder' })
    m5.parts = [{ id: 'p5', messageId: m5.id, sessionId: 'sess_ctx', type: 'text', text: 'recent answer' }]
    m5.id = 'kept_m5'

    const history = [m1, m2, record, m4, m5]
    const before = history.map((message) => message.id)

    const selection = selectStudioStoredConversation(history)
    assert.equal(selection.summary, 'SUMMARY TEXT')
    assert.equal(selection.firstKeptMessageId, 'kept_m4')
    assert.deepEqual(selection.messages.map((message) => message.id), ['kept_m4', 'kept_m5'])
    assert.equal(findLatestStudioCompaction(history)?.id, record.id)
    assert.deepEqual(readStudioCompactionMetadata(record), {
      firstKeptMessageId: 'kept_m4',
      tokensBefore: 900,
      model: 'm'
    })
    // Selection is a view: the original history keeps its control record and order.
    assert.deepEqual(history.map((message) => message.id), before)
  })

  await run('a compaction boundary missing from storage falls back to full raw history without a summary', async () => {
    const m1 = createStudioUserMessage({ sessionId: 'sess_missing', sceneId: 'scene_missing', text: 'old ask' })
    const m2 = createStudioAssistantMessage({ sessionId: 'sess_missing', sceneId: 'scene_missing', agent: 'builder' })
    m2.parts = [{ id: 'p_missing_2', messageId: m2.id, sessionId: 'sess_missing', type: 'text', text: 'old answer' }]
    const record = createStudioAssistantMessage({
      sessionId: 'sess_missing',
      sceneId: 'scene_missing',
      agent: 'builder',
      metadata: { compaction: { firstKeptMessageId: 'gone_m3', tokensBefore: 900, model: 'm' } }
    })
    record.summary = 'STALE SUMMARY'
    const m3 = createStudioUserMessage({ sessionId: 'sess_missing', sceneId: 'scene_missing', text: 'recent ask' })
    const m4 = createStudioAssistantMessage({ sessionId: 'sess_missing', sceneId: 'scene_missing', agent: 'builder' })
    m4.parts = [{ id: 'p_missing_4', messageId: m4.id, sessionId: 'sess_missing', type: 'text', text: 'recent answer' }]

    const history = [m1, m2, record, m3, m4]
    const selection = selectStudioStoredConversation(history)

    assert.equal(selection.summary, undefined)
    assert.equal(selection.firstKeptMessageId, undefined)
    // The unusable summary is dropped and every raw message survives, in order, without the control record.
    assert.deepEqual(selection.messages.map((message) => message.id), [m1.id, m2.id, m3.id, m4.id])
    assert.equal(selection.messages.some((message) => message.id === record.id), false)
    assert.deepEqual(history.map((message) => message.id), [m1.id, m2.id, record.id, m3.id, m4.id])
  })

  await run('compaction cut keeps a tool call and its result together and does not mutate inputs', async () => {
    const conversation: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
      { role: 'system', content: 'system' },
      { role: 'user', content: 'old ask' },
      {
        role: 'assistant',
        content: null,
        tool_calls: [{ id: 'call_1', type: 'function', function: { name: 'read', arguments: '{}' } }]
      } as OpenAI.Chat.Completions.ChatCompletionMessageParam,
      { role: 'tool', tool_call_id: 'call_1', content: 'tool output' },
      { role: 'assistant', content: 'old answer' },
      { role: 'user', content: 'recent ask' },
      { role: 'assistant', content: 'recent answer' }
    ]
    const sourceIds = [undefined, 'm1', 'm2', 'm2', 'm3', 'm4', 'm5']
    const snapshot = JSON.stringify(conversation)
    const sourceSnapshot = [...sourceIds]

    const plan = selectStudioCompactionPlan({
      conversation,
      sourceMessageIds: sourceIds,
      keepRecentTokens: 1,
      contextLimitTokens: 10_000
    })

    assert.equal(plan.firstKeptMessageId, 'm4')
    assert.deepEqual(plan.keptSourceMessageIds, ['m4', 'm5'])
    assert.deepEqual(plan.prefixMessages.map((message) => message.role), ['user', 'assistant', 'tool', 'assistant'])
    assert.deepEqual(plan.keptMessages.map((message) => message.role), ['user', 'assistant'])
    assert.equal(JSON.stringify(conversation), snapshot)
    assert.deepEqual(sourceIds, sourceSnapshot)

    const summaryInput = truncateStudioToolOutputsForSummary(conversation, 4)
    assert.deepEqual(summaryInput.map((message) => message.role), conversation.map((message) => message.role))
    assert.equal(summaryInput[3]?.role === 'tool' ? summaryInput[3].content : null, '\n...[truncated 7 chars for summary]')
    assert.equal(conversation[3]?.role === 'tool' ? conversation[3].content : null, 'tool output')

    const prompt = buildStudioCompactionSummaryPrompt({
      messages: conversation,
      previousSummary: 'previous facts'
    })
    assert.equal(prompt.length, 2)
    assert.equal(String(prompt[0]?.content).includes('Do not call tools'), true)
    assert.equal(String(prompt[1]?.content).includes('previous facts'), true)
  })

  await run('a persisted compaction record is reused as summary plus suffix on the next Run', async () => {
    const persistence = createInMemoryStudioPersistence()
    const session = createStudioSession({
      ownerId: 'owner-ctx',
      projectId: 'project-ctx',
      studioKind: 'manim',
      agentType: 'builder',
      title: 'Context reuse',
      directory: '/tmp/context-reuse'
    })
    const sceneId = 'scene_ctx'
    const m1 = createStudioUserMessage({ sessionId: session.id, sceneId, text: 'old ask' })
    m1.createdAt = '2026-01-01T00:00:00.000Z'
    const m2 = createStudioAssistantMessage({ sessionId: session.id, sceneId, agent: 'builder' })
    m2.createdAt = '2026-01-01T00:00:01.000Z'
    m2.metadata = { providerMessage: { content: 'old answer' } }
    const record = createStudioAssistantMessage({
      sessionId: session.id,
      sceneId,
      agent: 'builder',
      metadata: { compaction: { firstKeptMessageId: 'kept_ctx_m3', tokensBefore: 900, model: 'm' } }
    })
    record.createdAt = '2026-01-01T00:00:02.000Z'
    record.summary = 'PERSISTED SUMMARY'
    const m3 = createStudioUserMessage({ sessionId: session.id, sceneId, text: 'recent ask' })
    m3.id = 'kept_ctx_m3'
    m3.createdAt = '2026-01-01T00:00:03.000Z'
    const m4 = createStudioAssistantMessage({ sessionId: session.id, sceneId, agent: 'builder' })
    m4.createdAt = '2026-01-01T00:00:04.000Z'
    m4.metadata = { providerMessage: { content: 'recent answer' } }

    for (const message of [m1, m2, record, m3, m4]) {
      if (message.role === 'user') await persistence.messageStore.createUserMessage(message)
      else await persistence.messageStore.createAssistantMessage(message)
    }
    const runRecord = createStudioRun({
      ownerId: session.ownerId,
      sessionId: session.id,
      sceneId,
      inputText: 'next',
      activeAgent: 'builder'
    })
    const runtime = await createStudioLoopRuntime({
      projectId: session.projectId,
      session,
      run: runRecord,
      assistantMessage: createStudioAssistantMessage({ sessionId: session.id, sceneId, agent: 'builder' }),
      inputText: runRecord.inputText,
      messageStore: persistence.messageStore,
      registry: new StudioToolRegistry(),
      eventBus: new InMemoryStudioEventBus(),
      executionScope: createLegacyRunExecutionScope({ rootDirectory: session.directory }),
      createAssistantMessage: async () => createStudioAssistantMessage({ sessionId: session.id, sceneId, agent: 'builder' }),
      setToolMetadata: () => undefined,
      modelPort: { complete: async () => completion('unused') }
    })

    assert.equal(runtime.compactionSummary, 'PERSISTED SUMMARY')
    assert.equal(runtime.conversation[0]?.role, 'system')
    assert.equal(String(runtime.conversation[0].content).includes('PERSISTED SUMMARY'), true)
    assert.deepEqual(runtime.conversation.slice(1).map((message) => message.role), ['user', 'assistant'])
    assert.equal(JSON.stringify(runtime.conversation).includes('old ask'), false)
    assert.deepEqual(runtime.conversationSourceMessageIds, [undefined, 'kept_ctx_m3', m4.id])
  })

  await run('summarizer usage is counted in the same Run total as the retried step', async () => {
    const persistence = createInMemoryStudioPersistence()
    const session = createStudioSession({
      ownerId: 'owner-summary-usage',
      projectId: 'project-summary-usage',
      studioKind: 'manim',
      agentType: 'builder',
      title: 'Summary usage',
      directory: '/tmp/summary-usage'
    })
    const sceneId = 'scene_summary_usage'
    const m1 = createStudioUserMessage({ sessionId: session.id, sceneId, text: 'first ask' })
    const m2 = createStudioAssistantMessage({ sessionId: session.id, sceneId, agent: 'builder' })
    m2.metadata = { providerMessage: { content: 'x'.repeat(120_000) } }
    const m3 = createStudioUserMessage({ sessionId: session.id, sceneId, text: 'latest ask' })
    const m4 = createStudioAssistantMessage({ sessionId: session.id, sceneId, agent: 'builder' })
    m4.metadata = { providerMessage: { content: 'latest answer' } }
    for (const message of [m1, m2, m3, m4]) {
      if (message.role === 'user') await persistence.messageStore.createUserMessage(message)
      else await persistence.messageStore.createAssistantMessage(message)
    }

    const requests: StudioModelRequest[] = []
    const checkpoints: Array<{ totalTokens: number }> = []
    const model: StudioModelPort = {
      async complete(request) {
        requests.push(request)
        if (requests.length === 1) throw new Error('maximum context length exceeded')
        if (requests.length === 2) {
          // The summarizer call is a real provider invocation and carries its own usage.
          return completion('COMPACTED SUMMARY', { prompt_tokens: 300, completion_tokens: 20, total_tokens: 320 })
        }
        return completion('done', { prompt_tokens: 200, completion_tokens: 10, total_tokens: 210 })
      }
    }
    const runRecord = createStudioRun({
      ownerId: session.ownerId,
      sessionId: session.id,
      sceneId,
      inputText: 'next',
      activeAgent: 'builder'
    })

    await collect(createStudioOpenAIToolLoop({
      projectId: session.projectId,
      session,
      run: runRecord,
      assistantMessage: createStudioAssistantMessage({ sessionId: session.id, sceneId, agent: 'builder' }),
      executionScope: createLegacyRunExecutionScope({ rootDirectory: session.directory }),
      inputText: runRecord.inputText,
      messageStore: persistence.messageStore,
      registry: new StudioToolRegistry(),
      eventBus: new InMemoryStudioEventBus(),
      renderStore: persistence.renderStore,
      modelPort: model,
      createAssistantMessage: async () => createStudioAssistantMessage({ sessionId: session.id, sceneId, agent: 'builder' }),
      setToolMetadata: () => undefined,
      maxSteps: 1,
      onCheckpoint: async (patch) => {
        if (patch.tokenUsage) checkpoints.push(patch.tokenUsage)
      }
    }))

    assert.equal(requests.length, 3)
    assert.equal(requests[1]?.toolChoice, 'none')
    // Failed first request (unmeasured) + summary (320) + successful retry (210).
    assert.deepEqual(checkpoints.at(-1), {
      promptTokens: 500,
      completionTokens: 30,
      totalTokens: 530,
      measuredCalls: 2,
      unmeasuredCalls: 1
    })
  })

  await run('a provider overflow forces one compaction retry and never a second one', async () => {
    const persistence = createInMemoryStudioPersistence()
    const session = createStudioSession({
      ownerId: 'owner-overflow',
      projectId: 'project-overflow',
      studioKind: 'manim',
      agentType: 'builder',
      title: 'Overflow',
      directory: '/tmp/overflow'
    })
    const sceneId = 'scene_overflow'
    const m1 = createStudioUserMessage({ sessionId: session.id, sceneId, text: 'first ask' })
    const m2 = createStudioAssistantMessage({ sessionId: session.id, sceneId, agent: 'builder' })
    m2.metadata = { providerMessage: { content: 'x'.repeat(120_000) } }
    const m3 = createStudioUserMessage({ sessionId: session.id, sceneId, text: 'latest ask' })
    const m4 = createStudioAssistantMessage({ sessionId: session.id, sceneId, agent: 'builder' })
    m4.metadata = { providerMessage: { content: 'latest answer' } }
    for (const message of [m1, m2, m3, m4]) {
      if (message.role === 'user') await persistence.messageStore.createUserMessage(message)
      else await persistence.messageStore.createAssistantMessage(message)
    }

    const requests: StudioModelRequest[] = []
    const model: StudioModelPort = {
      async complete(request) {
        requests.push(request)
        if (requests.length === 2) return completion('COMPACTED SUMMARY')
        if (requests.length === 1 || requests.length === 3) {
          throw new Error('maximum context length exceeded')
        }
        return completion('unexpected')
      }
    }
    const runRecord = createStudioRun({
      ownerId: session.ownerId,
      sessionId: session.id,
      sceneId,
      inputText: 'next',
      activeAgent: 'builder'
    })

    await assert.rejects(
      collect(createStudioOpenAIToolLoop({
        projectId: session.projectId,
        session,
        run: runRecord,
        assistantMessage: createStudioAssistantMessage({ sessionId: session.id, sceneId, agent: 'builder' }),
        executionScope: createLegacyRunExecutionScope({ rootDirectory: session.directory }),
        inputText: runRecord.inputText,
        messageStore: persistence.messageStore,
        registry: new StudioToolRegistry(),
        eventBus: new InMemoryStudioEventBus(),
        renderStore: persistence.renderStore,
        modelPort: model,
        createAssistantMessage: async () => createStudioAssistantMessage({ sessionId: session.id, sceneId, agent: 'builder' }),
        setToolMetadata: () => undefined,
        maxSteps: 1
      })),
      /maximum context length exceeded/
    )

    // Initial request, one summarization, one retry: the second overflow is not compacted again.
    assert.equal(requests.length, 3)
    const compactionRecords = (await persistence.messageStore.listBySceneId(sceneId))
      .filter((message) => message.role === 'assistant'
        && (message.metadata?.compaction as { firstKeptMessageId?: unknown } | undefined)?.firstKeptMessageId)
    assert.equal(compactionRecords.length, 1)
    assert.equal(isStudioContextOverflowError(new Error('context_length_exceeded')), true)
    assert.equal(isStudioContextOverflowError(new Error('gateway timeout 504')), false)
  })
}
