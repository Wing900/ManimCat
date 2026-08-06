import type OpenAI from 'openai'
import type { CustomApiConfig } from '../../types'
import type { StudioToolChoice } from '../domain/types'
import { createCustomOpenAIClient } from '../../services/openai-client-factory'
import { requestStudioChatCompletion } from '../orchestration/studio-provider-request'

export interface StudioModelRequest {
  model: string
  messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[]
  tools: OpenAI.Chat.Completions.ChatCompletionTool[]
  toolChoice: StudioToolChoice
  sessionId: string
  runId: string
  step: number
  assistantMessageId: string
  studioKind?: 'manim' | 'plot'
  runCreatedAt: string
  requestMessageCount: number
  requestMessageCharsApprox: number
  requestToolSchemaCharsApprox: number
  signal?: AbortSignal
}

export type StudioModelResponse = OpenAI.Chat.Completions.ChatCompletion

export interface StudioModelPort {
  complete: (request: StudioModelRequest) => Promise<StudioModelResponse>
}

export function createOpenAICompatibleStudioModelAdapter(config: CustomApiConfig): StudioModelPort {
  const client = createCustomOpenAIClient(config)
  const model = config.model.trim()
  if (!model) {
    throw new Error('Studio agent requires a provider model')
  }

  return {
    complete(request) {
      return requestStudioChatCompletion({
        client,
        model: request.model || model,
        messages: request.messages,
        tools: request.tools,
        toolChoice: request.toolChoice,
        sessionId: request.sessionId,
        runId: request.runId,
        step: request.step,
        assistantMessageId: request.assistantMessageId,
        studioKind: request.studioKind,
        runCreatedAt: request.runCreatedAt,
        requestMessageCount: request.requestMessageCount,
        requestMessageCharsApprox: request.requestMessageCharsApprox,
        requestToolSchemaCharsApprox: request.requestToolSchemaCharsApprox,
        signal: request.signal,
      })
    }
  }
}
