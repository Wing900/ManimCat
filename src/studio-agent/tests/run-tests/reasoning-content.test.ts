import assert from 'node:assert/strict'
import type OpenAI from 'openai'
import { createStudioAssistantMessage } from '../../domain/factories'
import { buildStudioConversationMessages } from '../../orchestration/studio-message-history'
import {
  buildStoredProviderMessagePayload,
  toAssistantConversationMessage
} from '../../orchestration/studio-provider-message'
import { run } from './factories'

type ChatCompletionMessageWithReasoning = OpenAI.Chat.Completions.ChatCompletionMessage & {
  reasoning_content?: unknown
}

type ToolCallWithExtraSignature = OpenAI.Chat.Completions.ChatCompletionMessageToolCall & {
  function: OpenAI.Chat.Completions.ChatCompletionMessageToolCall.Function & {
    thought_signature?: string
  }
}

export async function runReasoningContentTests() {
  await run('provider message payload preserves reasoning content for thinking mode retries', async () => {
    const providerMessage: ChatCompletionMessageWithReasoning = {
      role: 'assistant',
      content: 'Let me inspect the workspace first.',
      reasoning_content: [
        {
          type: 'reasoning',
          text: 'Need to inspect files before making changes.',
          signature: 'sig_reasoning_1'
        }
      ],
      tool_calls: [
        {
          id: 'call_ls_1',
          type: 'function',
          function: {
            name: 'ls',
            arguments: '{"path":"src"}',
            thought_signature: 'tool_sig_1'
          }
        } as ToolCallWithExtraSignature
      ],
      refusal: null
    }

    const payload = buildStoredProviderMessagePayload(providerMessage)

    assert.deepEqual(payload.reasoning_content, providerMessage.reasoning_content)
    assert.deepEqual(payload.tool_calls, providerMessage.tool_calls)
  })

  await run('conversation replay returns stored reasoning content to the provider', async () => {
    const reasoningContent = [
      {
        type: 'reasoning',
        text: 'Need the original chain-of-thought token for the next call.',
        signature: 'sig_reasoning_replay'
      }
    ]
    const assistant = createStudioAssistantMessage({
      sessionId: 'sess_reasoning_replay',
      agent: 'builder',
      metadata: {
        providerMessage: {
          content: 'Checking the project structure.',
          reasoning_content: reasoningContent,
          tool_calls: [
            {
              id: 'call_ls_replay',
              type: 'function',
              function: {
                name: 'ls',
                arguments: '{"path":"."}',
                thought_signature: 'tool_sig_replay'
              }
            }
          ]
        }
      } as { providerMessage: { tool_calls?: ToolCallWithExtraSignature[] } }
    })

    const conversation = buildStudioConversationMessages({ messages: [assistant] })
    const assistantMessage = conversation[0] as OpenAI.Chat.Completions.ChatCompletionAssistantMessageParam & {
      reasoning_content?: Array<Record<string, unknown>>
    }

    assert.deepEqual(assistantMessage.reasoning_content, reasoningContent)
    assert.deepEqual(
      assistantMessage.tool_calls,
      (assistant.metadata as { providerMessage?: { tool_calls?: ToolCallWithExtraSignature[] } } | undefined)?.providerMessage?.tool_calls
    )
  })

  await run('live assistant turns keep reasoning content when appended back into the loop', async () => {
    const providerMessage: ChatCompletionMessageWithReasoning = {
      role: 'assistant',
      content: 'I will inspect the source tree.',
      reasoning_content: [
        {
          type: 'reasoning',
          text: 'Call ls before deciding whether to read files.',
          signature: 'sig_reasoning_live'
        }
      ],
      tool_calls: [],
      refusal: null
    }

    const assistantMessage = (
      toAssistantConversationMessage(providerMessage, 'I will inspect the source tree.', [])
    ) as OpenAI.Chat.Completions.ChatCompletionAssistantMessageParam & {
      reasoning_content?: Array<Record<string, unknown>>
    }

    assert.deepEqual(assistantMessage.reasoning_content, providerMessage.reasoning_content)
  })

  await run('string reasoning content is preserved for thinking mode retries', async () => {
    const providerMessage: ChatCompletionMessageWithReasoning = {
      role: 'assistant',
      content: '',
      reasoning_content: 'Need to inspect the workspace before answering.',
      tool_calls: [],
      refusal: null
    }

    const payload = buildStoredProviderMessagePayload(providerMessage)
    assert.equal(payload.reasoning_content, providerMessage.reasoning_content)

    const assistant = createStudioAssistantMessage({
      sessionId: 'sess_reasoning_string',
      agent: 'builder',
      metadata: {
        providerMessage: payload
      }
    })

    const conversation = buildStudioConversationMessages({ messages: [assistant] })
    const assistantMessage = conversation[0] as OpenAI.Chat.Completions.ChatCompletionAssistantMessageParam & {
      reasoning_content?: unknown
    }

    assert.equal(assistantMessage.reasoning_content, providerMessage.reasoning_content)
  })

  console.log('  Reasoning content tests passed')
}
