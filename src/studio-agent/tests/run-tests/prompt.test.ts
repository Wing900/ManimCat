import assert from 'node:assert/strict'
import {
  buildStudioAgentSystemPrompt,
  createStudioSession,
  WorkspacePathError,
  resolveWorkspacePath
} from '../../index'
import { getDefaultStudioWorkspacePath } from '../../infrastructure/workspace/default-studio-workspace'
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

  await run('default studio workspace lives in the system temp directory, not the project', async () => {
    const workspacePath = path.resolve(getDefaultStudioWorkspacePath())
    // Session workspaces hold user content for the length of a Run, so they must not sit inside the
    // project tree where they would be committed, backed up or shipped with the build.
    assert.equal(path.isAbsolute(workspacePath), true)
    assert.equal(workspacePath.startsWith(path.resolve(process.cwd())), false)
    assert.equal(path.basename(workspacePath), 'manimcat-studio')
  })

  await run('builder core carries structured scene facts for the manim scene', async () => {
    const directory = await createWorkspace()
    const session = createStudioSession({
      studioKind: 'manim',
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
    assert.doesNotMatch(prompt, /automatic_render_after/)
    assert.doesNotMatch(prompt, /<studio_render_context>/)
    assert.doesNotMatch(prompt, /<studio_documentation>/)
  })

  await run('the scene facts are kind-specific and the render instruction is shared', async () => {
    const directory = await createWorkspace()
    const session = createStudioSession({
      ownerId: 'owner-test',
      projectId: 'project-1',
      agentType: 'builder',
      title: 'Plot Prompt Session',
      directory,
      studioKind: 'matplotlib'
    })

    const prompt = buildStudioAgentSystemPrompt({
      session
    })

    assert.match(prompt, /\nkind: matplotlib\n/)
    assert.match(prompt, /\nlabel: Matplotlib Studio\n/)
    assert.match(prompt, /\nlanguage: python\n/)
    assert.match(prompt, /\noutputs: image\n/)
    assert.doesNotMatch(prompt, /\nlanguage: manim-python\n/)
    assert.ok(prompt.includes(`\nworkspace: ${directory}\n`))
    assert.doesNotMatch(prompt, /automatic_render_after/)
    // The Builder is told to render for both kinds, so no Mode has to render on its own.
    assert.match(prompt, /When the Scene source is complete, call `render` to produce the output\./)
    assert.doesNotMatch(prompt, /<studio_render_context>/)
    assert.doesNotMatch(prompt, /<studio_documentation>/)
  })

  await run('base prompts stay within the minimal size budget', async () => {
    const manimDirectory = await createWorkspace()
    const plotDirectory = await createWorkspace()
    const manimPrompt = buildStudioAgentSystemPrompt({
      session: createStudioSession({
        studioKind: 'manim',
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
        studioKind: 'matplotlib'
      })
    })

    // The budget tracks the current prompts plus a small margin: it is a bloat alarm, not a target.
    const basePromptBudget = 1000
    assert.ok(
      manimPrompt.length <= basePromptBudget + manimDirectory.length,
      `manim base prompt is ${manimPrompt.length} chars, budget is ${basePromptBudget + manimDirectory.length}`
    )
    assert.ok(
      plotPrompt.length <= basePromptBudget + plotDirectory.length,
      `plot base prompt is ${plotPrompt.length} chars, budget is ${basePromptBudget + plotDirectory.length}`
    )
  })

  await run('optional render context stays represented and documentation stays gone', async () => {
    const directory = await createWorkspace()
    const session = createStudioSession({
      studioKind: 'manim',
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
        studioKind: 'manim',
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
        studioKind: 'matplotlib'
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
    // Absolute paths derived from this platform's own root. A literal like `D:\outside` is only a
    // *relative* name on a POSIX runner, so it would be joined under the workspace root and the
    // assertion would fail there — the fixture has to be platform-shaped, not Windows-shaped.
    const platformRoot = path.parse(process.cwd()).root
    const workspaceRoot = path.join(platformRoot, 'manimcat-test-workspace')
    const allowedRoot = path.join(platformRoot, 'manimcat-test-skills')
    // Left unnormalized, so the error still has to report the caller's own target verbatim.
    const outsideTarget = [workspaceRoot, '..', 'outside', 'file.md'].join(path.sep)

    let error: unknown
    try {
      resolveWorkspacePath(workspaceRoot, outsideTarget, {
        allowedRoots: [allowedRoot]
      })
    } catch (caught) {
      error = caught
    }

    assert.ok(error instanceof WorkspacePathError)
    assert.equal(error.targetPath, outsideTarget)
    assert.equal(error.resolvedPath, path.resolve(outsideTarget))
    assert.equal(error.workspaceRoot, workspaceRoot)
    assert.deepEqual(error.allowedRoots, [workspaceRoot, allowedRoot])
  })

  console.log('  Prompt tests passed')
}
