import assert from 'node:assert/strict'
import {
  buildStudioAgentSystemPrompt,
  parseSkillDocument,
  createStudioSession,
  defaultRulesForLevel,
  createStudioSkillRuntime,
  WorkspacePathError,
  resolveWorkspacePath
} from '../../index'
import { getDefaultStudioWorkspacePath } from '../../workspace/default-studio-workspace'
import { createTestRuntime, createWorkspace, run } from './factories'
import path from 'node:path'
import { mkdir, writeFile } from 'node:fs/promises'

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

  await run('builder prompt requires code, checks, and confirmation before render', async () => {
    const session = createStudioSession({
      projectId: 'project-1',
      agentType: 'builder',
      title: 'Prompt Session',
      directory: await createWorkspace(),
      permissionLevel: 'L4',
      permissionRules: defaultRulesForLevel('L4')
    })

    const prompt = buildStudioAgentSystemPrompt({
      session
    })

    assert.match(prompt, /Workspace root:/)
    assert.match(prompt, /Do not call render until the target code has been written or updated in the workspace and checked with static-check/)
    assert.match(prompt, /use the question tool to ask for confirmation first/)
    assert.match(prompt, /prefer the smallest local edit or apply_patch change/)
    assert.match(prompt, /If the task is not finished, do not end the turn without a tool call\./)
    assert.match(prompt, /When any error happens, you must either call another tool to investigate or repair it, or call the question tool to ask the user how to proceed\./)
  })

  await run('plot builder prompt does not require static-check by default', async () => {
    const session = createStudioSession({
      projectId: 'project-1',
      agentType: 'builder',
      title: 'Plot Prompt Session',
      directory: await createWorkspace(),
      permissionLevel: 'L4',
      permissionRules: defaultRulesForLevel('L4'),
      studioKind: 'plot'
    })

    const prompt = buildStudioAgentSystemPrompt({
      session
    })

    assert.match(prompt, /Do not call render until the target code has been written or updated in the workspace\./)
    assert.match(prompt, /Use static-check only when the code is unusually complex, the risk is high, or repeated failures suggest it is needed\./)
    assert.match(prompt, /prefer the smallest local edit or apply_patch change/)
    assert.match(prompt, /If the task is not finished, do not end the turn without a tool call\./)
    assert.doesNotMatch(prompt, /checked with static-check/)
  })

  await run('skill parser reads frontmatter and body', async () => {
    const parsed = parseSkillDocument([
      '---',
      'name: color',
      'description: Use when palette guidance is needed.',
      'scope: plot',
      'tags: [palette, education]',
      'version: 1',
      '---',
      '',
      '# Color',
      '',
      'Choose colors carefully.'
    ].join('\n'))

    assert.equal(parsed.manifest.name, 'color')
    assert.equal(parsed.manifest.description, 'Use when palette guidance is needed.')
    assert.equal(parsed.manifest.scope, 'plot')
    assert.deepEqual(parsed.manifest.tags, ['palette', 'education'])
    assert.equal(parsed.manifest.version, 1)
    assert.match(parsed.body, /Choose colors carefully\./)
  })

  await run('skill discovery filters workspace skills by studio scope', async () => {
    const workspace = await createWorkspace()
    const plotSkillDir = path.join(workspace, '.manimcat', 'skills', 'plot-color')
    const manimSkillDir = path.join(workspace, '.manimcat', 'skills', 'manim-camera')
    await mkdir(plotSkillDir, { recursive: true })
    await mkdir(manimSkillDir, { recursive: true })
    await writeFile(path.join(plotSkillDir, 'SKILL.md'), [
      '---',
      'name: plot-color',
      'description: Plot palette guidance.',
      'scope: plot',
      '---',
      '',
      'Plot body.'
    ].join('\n'), 'utf8')
    await writeFile(path.join(manimSkillDir, 'SKILL.md'), [
      '---',
      'name: manim-camera',
      'description: Manim camera guidance.',
      'scope: manim',
      '---',
      '',
      'Manim body.'
    ].join('\n'), 'utf8')

    const plotSession = createStudioSession({
      projectId: 'project-1',
      agentType: 'builder',
      title: 'Plot Skill Registry',
      directory: workspace,
      permissionLevel: 'L4',
      permissionRules: defaultRulesForLevel('L4'),
      studioKind: 'plot'
    })
    const manimSession = createStudioSession({
      projectId: 'project-1',
      agentType: 'builder',
      title: 'Manim Skill Registry',
      directory: workspace,
      permissionLevel: 'L4',
      permissionRules: defaultRulesForLevel('L4'),
      studioKind: 'manim'
    })

    const skillRuntime = createStudioSkillRuntime()
    const plotEntries = await skillRuntime.listDiscovery(plotSession)
    const manimEntries = await skillRuntime.listDiscovery(manimSession)
    assert.equal(plotEntries.some((entry) => entry.name === 'plot-color'), true)
    assert.equal(plotEntries.some((entry) => entry.name === 'manim-camera'), false)
    assert.equal(manimEntries.some((entry) => entry.name === 'manim-camera'), true)
    assert.equal(manimEntries.some((entry) => entry.name === 'plot-color'), false)
  })

  await run('prompt includes discovered skills and prior skill summaries', async () => {
    const workspace = await createWorkspace()
    const skillDir = path.join(workspace, '.manimcat', 'skills', 'color')
    await mkdir(skillDir, { recursive: true })
    await writeFile(path.join(skillDir, 'SKILL.md'), [
      '---',
      'name: color',
      'description: Use when palette guidance is needed.',
      'scope: plot',
      'tags: [palette, education]',
      '---',
      '',
      '# Color',
      '',
      'Choose colors carefully.'
    ].join('\n'), 'utf8')

    const session = createStudioSession({
      projectId: 'project-1',
      agentType: 'builder',
      title: 'Skill Prompt Session',
      directory: workspace,
      permissionLevel: 'L4',
      permissionRules: defaultRulesForLevel('L4'),
      studioKind: 'plot'
    })

    const skillRuntime = createStudioSkillRuntime()
    await skillRuntime.recordUsage({
      session,
      skillName: 'color',
      reason: 'User did not specify a palette.',
      takeaway: 'Muted blue-orange contrast.',
      stillRelevant: true
    })

    const prompt = buildStudioAgentSystemPrompt({
      session,
      availableSkills: await skillRuntime.listDiscovery(session),
      skillSummaries: await skillRuntime.listSummaries(session)
    })

    assert.match(prompt, /<studio_skill_catalog>/)
    assert.match(prompt, /- color: Use when palette guidance is needed\./)
    assert.match(prompt, /<studio_skill_state>/)
    assert.match(prompt, /Muted blue-orange contrast\./)
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