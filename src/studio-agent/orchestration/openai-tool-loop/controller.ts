import type { StudioProcessorStreamEvent } from '../../domain/types'
import { throwIfStudioRunCancelled } from '../../runtime/execution/run-cancellation'
import { StudioTokenUsageTracker } from '../../runs/studio-token-usage-tracker'
import { determineStudioAgentLoopAction } from './loop-policy'
import { appendStudioAssistantConversationTurn, emitStudioAssistantText } from './message-assembly'
import { createStudioLoopFinishStepEvent, logStudioLoopStepFinished } from './observability'
import { getStudioTelemetry } from '../../infrastructure/telemetry/studio-telemetry'
import {
  buildStudioLoopStepRequest,
  compactStudioLoopContext,
  createStudioLoopRuntime,
  persistStudioProviderSnapshot,
  requestStudioLoopStep
} from './request-builder'
import { calibrateStudioTokenRatio } from '../../context/context-budget'
import { isStudioContextOverflowError } from '../../context/context-overflow'
import { StudioLoopCheckpointManager } from './state'
import { executeStudioToolCallsForStep } from './tool-dispatch'
import type { StudioLoopRuntime, StudioLoopStepResult, StudioOpenAIToolLoopInput } from './types'

export async function* createStudioOpenAIToolLoop(
  input: StudioOpenAIToolLoopInput
): AsyncGenerator<StudioProcessorStreamEvent> {
  const runtime = await createStudioLoopRuntime(input)
  const checkpoints = new StudioLoopCheckpointManager(input)
  const onCheckpoint = input.onCheckpoint
  const usageTracker = new StudioTokenUsageTracker({
    initialUsage: input.run.tokenUsage,
    checkpoint: onCheckpoint ? (usage) => onCheckpoint({ tokenUsage: usage }) : undefined
  })
  getStudioTelemetry().timeline({ studioKind: input.session.studioKind, name: 'loop.started', detail: `maxSteps=${runtime.maxSteps}` })

  let forcedCompactionRetry = false

  for (let step = 0; step < runtime.maxSteps; step += 1) {
    throwIfStudioRunCancelled(input.abortSignal)
    const stepStartedAt = Date.now()

    if (step > 0) {
      runtime.currentAssistantMessage = await input.createAssistantMessage()
      yield {
        type: 'assistant-message-start',
        message: runtime.currentAssistantMessage
      }
    }

    const autonomy = await checkpoints.beginStep()
    throwIfStudioRunCancelled(input.abortSignal)

    // Actual compaction happens before the model step, inside the same Run and with the same model.
    let request = buildStudioLoopStepRequest(runtime)
    if (await compactStudioLoopContext({ loopInput: input, runtime, step, force: false, usageTracker })) {
      request = buildStudioLoopStepRequest(runtime)
    }

    let result: StudioLoopStepResult
    try {
      result = await requestStudioLoopStep({
        loopInput: input,
        runtime,
        request,
        step,
        stepStartedAt,
        usageTracker
      })
    } catch (error) {
      // Exactly one forced compact-and-retry per Run. Other failures keep their original retry policy.
      if (forcedCompactionRetry || !isStudioContextOverflowError(error)) {
        throw error
      }
      forcedCompactionRetry = true
      await compactStudioLoopContext({ loopInput: input, runtime, step, force: true, usageTracker })
      request = buildStudioLoopStepRequest(runtime)
      result = await requestStudioLoopStep({
        loopInput: input,
        runtime,
        request,
        step,
        stepStartedAt,
        usageTracker
      })
    }

    runtime.contextTokenRatio = calibrateStudioTokenRatio({
      estimatedTokens: request.estimatedTokens,
      actualPromptTokens: result.completion.usage?.prompt_tokens,
      currentRatio: runtime.contextTokenRatio,
    })

    await persistStudioProviderSnapshot(input, runtime.currentAssistantMessage, result.message)
    yield* emitStudioAssistantText(result.assistantText)

    const nextAction = determineStudioAgentLoopAction({
      finishReason: result.completion.choices[0]?.finish_reason ?? null,
      toolCallCount: result.toolCalls.length,
      step,
      maxSteps: runtime.maxSteps
    })

    if (nextAction.type === 'finish') {
      await checkpoints.markSuccess()
      getStudioTelemetry().timeline({ studioKind: input.session.studioKind, name: 'run.completed' })
      yield createStudioLoopFinishStepEvent(result.completion)
      return
    }

    if (nextAction.type === 'abort') {
      yield* emitStudioAssistantText(nextAction.message)
      await checkpoints.markFailure(nextAction.message)
      getStudioTelemetry().timeline({ studioKind: input.session.studioKind, name: 'run.completed', detail: 'aborted' })
      yield createStudioLoopFinishStepEvent(result.completion)
      return
    }

    appendStudioAssistantConversationTurn(runtime, result)
    syncStudioConversationSourceIds(runtime)

    const toolIterator = executeStudioToolCallsForStep(input, runtime, result, autonomy)
    let toolExecution: IteratorResult<StudioProcessorStreamEvent, { failureMessage: string | null }>
    while (true) {
      toolExecution = await toolIterator.next()
      if (toolExecution.done) {
        break
      }
      yield toolExecution.value
    }

    if (toolExecution.value.failureMessage) {
      const failedAutonomy = await checkpoints.markFailure(toolExecution.value.failureMessage)
      if (failedAutonomy.consecutiveFailures >= failedAutonomy.maxConsecutiveFailures) {
        const stopMessage = `Stopped after ${failedAutonomy.consecutiveFailures} consecutive failures: ${toolExecution.value.failureMessage}`
        await checkpoints.markStopped(stopMessage)
        getStudioTelemetry().timeline({ studioKind: input.session.studioKind, name: 'run.failed', detail: toolExecution.value.failureMessage })
        yield createStudioLoopFinishStepEvent(result.completion)
        return
      }
    } else {
      await checkpoints.markSuccess()
    }

    logStudioLoopStepFinished({
      loopInput: input,
      step,
      failed: Boolean(toolExecution.value.failureMessage),
      stepStartedAt
    })

    syncStudioConversationSourceIds(runtime)
    yield createStudioLoopFinishStepEvent(result.completion)
  }
}

/**
 * Tool dispatch appends assistant/tool messages directly to the runtime conversation. Every such
 * message belongs to the current assistant message, which is the id its boundary is persisted by.
 */
function syncStudioConversationSourceIds(runtime: StudioLoopRuntime): void {
  while (runtime.conversationSourceMessageIds.length < runtime.conversation.length) {
    runtime.conversationSourceMessageIds.push(runtime.currentAssistantMessage.id)
  }
  runtime.conversationSourceMessageIds.length = runtime.conversation.length
}
