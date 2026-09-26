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

  await run('builder core carries structured scene facts for the manim scene', async () => {
    const directory = await createWorkspace()
    const session = createStudioSession({
      ownerId: 'owner-test',
      projectId: 'project-1',
      agentType: 'builder',
      title: 'Prompt Session',
      directory
    })

    const prompt = buildStudioAgentSystemPrompt({
      session
    })

    assert.match(prompt, /^You are the builder for the current Studio scene\./)
    assert.match(prompt, /\n<studio_scene>\n/)
    assert.ok(prompt.endsWith('</studio_scene>'))
    assert.match(prompt, /\nkind: manim\n/)
    assert.match(prompt, /\nlabel: Manim Studio\n/)
    assert.match(prompt, /\nlanguage: manim-python\n/)
    assert.match(prompt, /\noutputs: video, image\n/)
    assert.ok(prompt.includes(`\nworkspace: ${directory}\n`))
    assert.match(prompt, /\nautomatic_render_after: none\n/)
    assert.doesNotMatch(prompt, /<studio_render_context>/)
    assert.doesNotMatch(prompt, /<studio_documentation>/)
  })

  await run('plot scene carries auto-render facts without a domain manual', async () => {
    const directory = await createWorkspace()
    const session = createStudioSession({
      ownerId: 'owner-test',
      projectId: 'project-1',
      agentType: 'builder',
      title: 'Plot Prompt Session',
      directory,
      studioKind: 'plot'
    })

    const prompt = buildStudioAgentSystemPrompt({
      session
    })

    assert.match(prompt, /\nkind: plot\n/)
    assert.match(prompt, /\nlabel: Matplotlib Studio\n/)
    assert.match(prompt, /\nlanguage: python\n/)
    assert.match(prompt, /\noutputs: image\n/)
    assert.doesNotMatch(prompt, /\nlanguage: manim-python\n/)
    assert.ok(prompt.includes(`\nworkspace: ${directory}\n`))
    assert.match(prompt, /\nautomatic_render_after: write, edit, apply_patch\n/)
    assert.doesNotMatch(prompt, /<studio_render_context>/)
    assert.doesNotMatch(prompt, /<studio_documentation>/)
  })

  await run('base prompts stay within the minimal size budget', async () => {
    const manimDirectory = await createWorkspace()
    const plotDirectory = await createWorkspace()
    const manimPrompt = buildStudioAgentSystemPrompt({
      session: createStudioSession({
        ownerId: 'owner-test',
        projectId: 'project-1',
        agentType: 'builder',
        title: 'Prompt Budget Session',
        directory: manimDirectory
      })
    })
    const plotPrompt = buildStudioAgentSystemPrompt({
      session: createStudioSession({
        ownerId: 'owner-test',
        projectId: 'project-1',
        agentType: 'builder',
        title: 'Prompt Budget Session',
        directory: plotDirectory,
        studioKind: 'plot'
      })
    })

    assert.ok(
      manimPrompt.length <= 900 + manimDirectory.length,
      `manim base prompt is ${manimPrompt.length} chars, budget is ${900 + manimDirectory.length}`
    )
    assert.ok(
      plotPrompt.length <= 900 + plotDirectory.length,
      `plot base prompt is ${plotPrompt.length} chars, budget is ${900 + plotDirectory.length}`
    )
  })

  await run('optional render context stays represented and documentation stays gone', async () => {
    const directory = await createWorkspace()
    const session = createStudioSession({
      ownerId: 'owner-test',
      projectId: 'project-1',
      agentType: 'builder',
      title: 'Prompt Context Session',
      directory
    })

    const prompt = buildStudioAgentSystemPrompt({
      session,
      renderContext: {
        sessionId: session.id,
        agent: 'builder',
        latestRender: {
          id: 'render-1',
          status: 'completed',
          timestamp: Date.UTC(2026, 0, 2)
        }
      }
    })

    assert.match(prompt, /<studio_render_context>\nsession_id: /)
    assert.match(prompt, /\nlatest_render_id: render-1\n/)
    assert.match(prompt, /\nlatest_render_status: completed\n/)
    assert.match(prompt, /\n<\/studio_render_context>$/)
    assert.doesNotMatch(prompt, /<studio_documentation>/)
  })

  await run('removed domain manual phrases do not return', async () => {
    const manimPrompt = buildStudioAgentSystemPrompt({
      session: createStudioSession({
        ownerId: 'owner-test',
        projectId: 'project-1',
        agentType: 'builder',
        title: 'Prompt Regression Session',
        directory: await createWorkspace()
      })
    })
    const plotPrompt = buildStudioAgentSystemPrompt({
      session: createStudioSession({
        ownerId: 'owner-test',
        projectId: 'project-1',
        agentType: 'builder',
        title: 'Prompt Regression Session',
        directory: await createWorkspace(),
        studioKind: 'plot'
      })
    })

    const removedPhrases = [
      'Math Modeling First',
      'Priorities:',
      'Prefer one small safe step at a time',
      '完成 static-check，才能渲染',
      '文档上下文命名空间'
    ]

    for (const phrase of removedPhrases) {
      assert.ok(!manimPrompt.includes(phrase), `manim prompt leaked: ${phrase}`)
      assert.ok(!plotPrompt.includes(phrase), `plot prompt leaked: ${phrase}`)
    }

    assert.doesNotMatch(manimPrompt, /subagent/i)
    assert.doesNotMatch(manimPrompt, /question tool/)
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
