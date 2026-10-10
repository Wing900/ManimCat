import { getStudioTelemetry, readElapsedMs, readRunElapsedMs } from '../../observability/studio-telemetry'
import type {
  StudioChatCompletion,
  StudioLoopStepRequest,
  StudioLoopStepResult,
  StudioOpenAIToolLoopInput
} from './types'

export function logStudioLoopStepStarted(input: {
  loopInput: StudioOpenAIToolLoopInput
  conversationLength: number
  toolCount: number
  request: StudioLoopStepRequest
  step: number
}) {
  getStudioTelemetry().event({ studioKind: input.loopInput.session.studioKind ?? 'manim', name: 'step.started', data: {
    sessionId: input.loopInput.session.id,
    runId: input.loopInput.run.id,
    step: input.step + 1,
    conversationMessages: input.conversationLength + 1,
    toolCount: input.toolCount,
    requestMessageCharsApprox: input.request.requestMessageCharsApprox,
    requestToolSchemaCharsApprox: input.request.requestToolSchemaCharsApprox,
    runElapsedMs: readRunElapsedMs(input.loopInput.run),
  } })
}

export function logStudioLoopStepResponse(input: {
  loopInput: StudioOpenAIToolLoopInput
  result: StudioLoopStepResult
  step: number
  stepStartedAt: number
}) {
  const choice = input.result.completion.choices[0]
  getStudioTelemetry().event({ studioKind: input.loopInput.session.studioKind ?? 'manim', name: 'step.response', data: {
    sessionId: input.loopInput.session.id,
    runId: input.loopInput.run.id,
    step: input.step + 1,
    finishReason: choice?.finish_reason ?? null,
    toolCallCount: input.result.toolCalls.length,
    assistantTextLength: input.result.assistantText.length,
    stepDurationMs: readElapsedMs(input.stepStartedAt),
    runElapsedMs: readRunElapsedMs(input.loopInput.run),
  } })
}

export function logStudioLoopStepFinished(input: {
  loopInput: StudioOpenAIToolLoopInput
  step: number
  failed: boolean
  stepStartedAt: number
}) {
  getStudioTelemetry().event({ studioKind: input.loopInput.session.studioKind ?? 'manim', name: 'step.finished', data: {
    sessionId: input.loopInput.session.id,
    runId: input.loopInput.run.id,
    step: input.step + 1,
    status: input.failed ? 'failed' : 'completed',
    stepDurationMs: readElapsedMs(input.stepStartedAt),
    runElapsedMs: readRunElapsedMs(input.loopInput.run),
  } })
}

export function createStudioLoopFinishStepEvent(completion: StudioChatCompletion) {
  return {
    type: 'finish-step' as const,
    usage: {
      tokens: completion.usage?.total_tokens
    }
  }
}
