import assert from 'node:assert/strict'
import {
  buildStudioAgentSystemPrompt,
  createStudioSession,
  WorkspacePathError,
  resolveWorkspacePath
} from '../../index'
import { getDefaultStudioWorkspacePath } from '../../workspace/default-studio-workspace'
import { createWorkspace, run } from './factories'
import path from 'node:path'

export async function runPromptTests() {
  await run('studio route helpers build stable envelopes', async () => {
    const { createStudioSuccess, createStudioError } = await import('../../../routes/helpers/studio-agent-responses')
    assert.deepEqual(createStudioSuccess({ foo: 'bar' }), {
      ok: true,
      data: { foo: 'bar' }
    })
    assert.deepEqual(createStudioError('INVALID_INPUT', 'bad request'), {
      ok: false,
      error: {
        code: 'INVALID_INPUT',
        message: 'bad request'
      }
    })
  })

  await run('default studio workspace uses dedicated hidden directory', async () => {
    assert.equal(getDefaultStudioWorkspacePath(), path.join(process.cwd(), '.studio-workspace'))
  })

  await run('builder prompt requires code and checks before render', async () => {
    const session = createStudioSession({
      ownerId: 'owner-test',
      projectId: 'project-1',
      agentType: 'builder',
      title: 'Prompt Session',
      directory: await createWorkspace()
    })

    const prompt = buildStudioAgentSystemPrompt({
      session
    })

    assert.match(prompt, /工作目录：/)
    assert.match(prompt, /完成 static-check，才能渲染/)
    assert.doesNotMatch(prompt, /question tool/)
    assert.match(prompt, /Prefer one small safe step at a time: inspect, edit, check, confirm, then render\./)
    assert.match(prompt, /If the task is not finished, do not end the turn without a tool call\./)
    assert.match(prompt, /When any error happens, call another tool to investigate or repair it before ending the run\./)
    assert.doesNotMatch(prompt, /subagent/i)
  })

  await run('plot builder prompt does not require static-check by default', async () => {
    const session = createStudioSession({
      ownerId: 'owner-test',
      projectId: 'project-1',
      agentType: 'builder',
      title: 'Plot Prompt Session',
      directory: await createWorkspace(),
      studioKind: 'plot'
    })

    const prompt = buildStudioAgentSystemPrompt({
      session
    })

    assert.match(prompt, /Before rendering, make sure the target Python code already exists and is ready\./)
    assert.match(prompt, /Add static-check only when the code is unusually complex, high-risk, or repeated failures suggest it is worth the cost\./)
    assert.match(prompt, /When fixing an existing file after a render failure, prefer a small local patch or targeted replacement over rewriting the whole file\./)
    assert.match(prompt, /If the task is not finished, do not end the turn without a tool call\./)
    assert.doesNotMatch(prompt, /checked with static-check/)
  })

  await run('workspace path errors expose allowed roots for debugging', async () => {
    let error: unknown
    try {
      resolveWorkspacePath('D:\\workspace', 'D:\\outside\\file.md', {
        allowedRoots: ['D:\\skills\\demo']
      })
    } catch (caught) {
      error = caught
    }

    assert.ok(error instanceof WorkspacePathError)
    assert.equal(error.targetPath, 'D:\\outside\\file.md')
    assert.equal(error.resolvedPath, path.resolve('D:\\outside\\file.md'))
    assert.equal(error.workspaceRoot, path.resolve('D:\\workspace'))
    assert.deepEqual(error.allowedRoots, [
      path.resolve('D:\\workspace'),
      path.resolve('D:\\skills\\demo')
    ])
  })

  console.log('  Prompt tests passed')
}
