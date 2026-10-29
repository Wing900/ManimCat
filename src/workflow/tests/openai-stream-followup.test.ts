import { test } from 'node:test'
import assert from 'node:assert/strict'
import OpenAI from 'openai'
import { createChatCompletionText } from '../openai-stream'

/**
 * These tests cover the reasoning-exhaustion follow-up in createChatCompletionText.
 *
 * The OpenAI client is mocked so we can shape the stream: a thinking model that emits only
 * `reasoning_content` deltas (no `content` delta) must trigger one streamed follow-up turn and
 * return its answer with `followupApplied: true`.
 */

interface FakeRequest {
  model?: string
  messages?: unknown[]
  stream?: boolean
  max_completion_tokens?: number
  max_tokens?: number
}

interface FakeChunk {
  choices?: Array<{ delta?: { content?: string; reasoning_content?: string } }>
  usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number }
}

interface FakeNonStreamResponse {
  choices: Array<{ message?: { content?: string } }>
  usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number }
}

type CreateResult = AsyncIterable<FakeChunk> | FakeNonStreamResponse

function buildClient(behaviour: {
  streamChunks: FakeChunk[]
  followup: (req: FakeRequest, callIndex: number) => FakeNonStreamResponse | Error
}): { client: any; calls: FakeRequest[] } {
  const calls: FakeRequest[] = []
  let followupCallIndex = 0
  const client = {
    chat: {
      completions: {
        create: async (req: FakeRequest): Promise<CreateResult> => {
          calls.push(req)
          if (req.stream && calls.length === 1) {
            return (async function* (): AsyncGenerator<FakeChunk> {
              for (const chunk of behaviour.streamChunks) {
                yield chunk
              }
            })()
          }
          const result = behaviour.followup(req, followupCallIndex)
          followupCallIndex += 1
          if (result instanceof Error) {
            throw result
          }
          return (async function* (): AsyncGenerator<FakeChunk> {
            for (const choice of result.choices) {
              yield { choices: [{ delta: { content: choice.message?.content } }] }
            }
            if (result.usage) yield { choices: [], usage: result.usage }
          })()
        }
      }
    }
  }
  return { client, calls }
}

function makeApiError(message: string, status = 400): Error {
  // isUnsupportedReasoningParamError checks `instanceof OpenAI.APIError`, so the fake error must
  // actually inherit from it rather than merely duck-typing the fields.
  const err = new Error(message) as Error & { status?: number }
  Object.setPrototypeOf(err, OpenAI.APIError.prototype)
  err.status = status
  err.name = 'APIError'
  return err
}

const baseRequest = {
  model: 'deepseek-v4.1-flash',
  messages: [
    { role: 'system', content: 'you are a coder' },
    { role: 'user', content: 'write a scene' }
  ],
  max_completion_tokens: 32800
}

test('follow-up triggers when stream emits only reasoning_content and returns the follow-up answer', async () => {
  const { client, calls } = buildClient({
    streamChunks: [
      { choices: [{ delta: { reasoning_content: 'let me think...' } }] },
      { choices: [{ delta: { reasoning_content: 'more thinking...' } }] },
      {
        choices: [{ delta: {} }],
        usage: { prompt_tokens: 4613, completion_tokens: 1000, total_tokens: 5613 }
      }
    ],
    followup: () => ({
      choices: [{ message: { content: 'from manim import *\nclass MainScene(Scene): ...' } }],
      usage: { prompt_tokens: 4800, completion_tokens: 1200, total_tokens: 6000 }
    })
  })

  const result = await createChatCompletionText(client, baseRequest as any, { usageLabel: 'code-generation-1' })

  assert.equal(result.content, 'from manim import *\nclass MainScene(Scene): ...')
  assert.equal(result.mode, 'stream')
  assert.equal(result.followupApplied, true)
  // First call was the stream, second was the strategy-B follow-up.
  assert.equal(calls.length, 2)
  assert.equal(calls[0].stream, true)
  assert.equal(calls[1].stream, true)
  // Strategy B replay: assistant turn carries reasoning_content, then a user turn.
  const followupMessages = calls[1].messages as Array<{ role: string; content?: string; reasoning_content?: string }>
  const assistant = followupMessages[followupMessages.length - 2]
  const user = followupMessages[followupMessages.length - 1]
  assert.equal(assistant.role, 'assistant')
  assert.equal(assistant.reasoning_content, 'let me think...more thinking...')
  assert.equal(user.role, 'user')
  assert.ok(user.content && user.content.length > 0)
})

test('follow-up is not triggered when the stream already produced content', async () => {
  const { client, calls } = buildClient({
    streamChunks: [
      { choices: [{ delta: { reasoning_content: 'thinking...' } }] },
      { choices: [{ delta: { content: 'final answer' } }] }
    ],
    followup: () => ({ choices: [{ message: { content: 'should not be used' } }] })
  })

  const result = await createChatCompletionText(client, baseRequest as any)

  assert.equal(result.content, 'final answer')
  assert.equal(result.mode, 'stream')
  assert.equal(result.followupApplied, undefined)
  assert.equal(calls.length, 1)
})

test('strategy B rejecting reasoning_content param falls back to strategy A', async () => {
  let followupCall = 0
  const { client, calls } = buildClient({
    streamChunks: [
      { choices: [{ delta: { reasoning_content: 'only reasoning' } }] }
    ],
    followup: (_req, idx) => {
      followupCall += 1
      // First follow-up call (strategy B) is rejected by the provider.
      if (idx === 0) {
        return makeApiError('unknown parameter reasoning_content', 400)
      }
      // Second follow-up call (strategy A) succeeds.
      return {
        choices: [{ message: { content: 'final code from strategy A' } }],
        usage: { prompt_tokens: 100, completion_tokens: 200, total_tokens: 300 }
      }
    }
  })

  const result = await createChatCompletionText(client, baseRequest as any)

  assert.equal(result.content, 'final code from strategy A')
  assert.equal(result.followupApplied, true)
  assert.equal(calls.length, 3, 'stream + strategy B + strategy A')
  // Strategy A must NOT carry reasoning_content on the assistant turn.
  const strategyA = calls[2].messages as Array<{ role: string; reasoning_content?: string }>
  assert.ok(!strategyA.some((m) => m.reasoning_content !== undefined))
})

test('when both strategy B and strategy A return empty content, the original empty content is returned', async () => {
  const { client } = buildClient({
    streamChunks: [
      { choices: [{ delta: { reasoning_content: 'only reasoning' } }] }
    ],
    followup: () => ({ choices: [{ message: { content: '' } }] })
  })

  const result = await createChatCompletionText(client, baseRequest as any)

  assert.equal(result.content, '')
  assert.equal(result.followupApplied, undefined)
})

test('a non-param API error from strategy B is rethrown, not swallowed', async () => {
  const { client } = buildClient({
    streamChunks: [
      { choices: [{ delta: { reasoning_content: 'only reasoning' } }] }
    ],
    followup: () => makeApiError('rate limit exceeded', 429)
  })

  await assert.rejects(
    () => createChatCompletionText(client, baseRequest as any),
    /rate limit exceeded/
  )
})