import type { StudioProcessorStreamEvent } from '../../domain/types'
import { throwIfStudioRunCancelled } from '../../runtime/execution/run-cancellation'
import { determineStudioAgentLoopAction } from './loop-policy'
import { appendStudioAssistantConversationTurn, emitStudioAssistantText } from './message-assembly'
import { createStudioLoopFinishStepEvent, logStudioLoopStepFinished } from './observability'
import { logTimeline } from '../../observability/plot-studio-timing'
import {
  buildStudioLoopStepRequest,
  createStudioLoopRuntime,
  persistStudioProviderSnapshot,
  requestStudioLoopStep
} from './request-builder'
import { StudioLoopCheckpointManager } from './state'
import { executeStudioToolCallsForStep } from './tool-dispatch'
import type { StudioOpenAIToolLoopInput } from './types'

export async function* createStudioOpenAIToolLoop(
  input: StudioOpenAIToolLoopInput
): AsyncGenerator<StudioProcessorStreamEvent> {
  const runtime = await createStudioLoopRuntime(input)
  const checkpoints = new StudioLoopCheckpointManager(input)
  logTimeline(input.session.studioKind, 'loop.started', `maxSteps=${runtime.maxSteps}`)

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
    const request = buildStudioLoopStepRequest(runtime)
    const result = await requestStudioLoopStep({
      loopInput: input,
      runtime,
      request,
      step,
      stepStartedAt
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
      logTimeline(input.session.studioKind, 'run.completed')
      yield createStudioLoopFinishStepEvent(result.completion)
      return
    }

    if (nextAction.type === 'abort') {
      yield* emitStudioAssistantText(nextAction.message)
      await checkpoints.markFailure(nextAction.message)
      logTimeline(input.session.studioKind, 'run.completed', 'aborted')
      yield createStudioLoopFinishStepEvent(result.completion)
      return
    }

    appendStudioAssistantConversationTurn(runtime, result)

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
        yield* emitStudioAssistantText(stopMessage)
        await checkpoints.markStopped(stopMessage)
        logTimeline(input.session.studioKind, 'run.failed', toolExecution.value.failureMessage)
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

    yield createStudioLoopFinishStepEvent(result.completion)
  }
}
