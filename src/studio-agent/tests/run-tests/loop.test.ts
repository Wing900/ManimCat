import assert from 'node:assert/strict'
import { determineStudioAgentLoopAction } from '../../index'
import { run } from './factories'

export async function runLoopTests() {
  await run('loop policy finishes when the assistant stops calling tools', async () => {
    const decision = determineStudioAgentLoopAction({
      finishReason: 'stop',
      toolCallCount: 0,
      step: 0,
      maxSteps: 8
    })

    assert.deepEqual(decision, { type: 'finish' })
  })

  await run('loop policy continues when tool calls are returned with budget left', async () => {
    const decision = determineStudioAgentLoopAction({
      finishReason: 'tool_calls',
      toolCallCount: 2,
      step: 2,
      maxSteps: 8
    })

    assert.deepEqual(decision, { type: 'continue' })
  })

  await run('loop policy aborts when tool calls would exceed the safety step limit', async () => {
    const decision = determineStudioAgentLoopAction({
      finishReason: 'tool_calls',
      toolCallCount: 1,
      step: 7,
      maxSteps: 8
    })

    assert.deepEqual(decision, {
      type: 'abort',
      message: 'Stopped after reaching the Studio agent step limit (8).'
    })
  })

  await run('loop policy surfaces provider stop reasons without leaking loop internals', async () => {
    const decision = determineStudioAgentLoopAction({
      finishReason: 'length',
      toolCallCount: 0,
      step: 0,
      maxSteps: 8
    })

    assert.deepEqual(decision, {
      type: 'abort',
      message: 'Studio agent response hit the model output limit before finishing.'
    })
  })

  console.log('  Loop tests passed')
}