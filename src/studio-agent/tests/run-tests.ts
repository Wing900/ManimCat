import assert from 'node:assert/strict'
import {
  buildStudioAgentSystemPrompt,
  buildStudioSubagentPrompt,
  buildReviewerStructuredReport,
  createRenderStatusSessionEvent,
  createStudioAssistantMessage,
  createStudioLsTool,
  createStudioRun,
  createStudioSession,
  createStudioSkillRuntime,
  createStudioTask,
  createStudioToolPart,
  createStudioWork,
  enqueueSessionEvent,
  extractStudioWorkflowInput,
  flushTerminalSessionEventsToAssistant,
  getStudioSessionAgentConfig,
  InMemoryStudioEventBus,
  InMemoryStudioMessageStore,
  InMemoryStudioPartStore,
  InMemoryStudioRunStore,
  InMemoryStudioSessionEventStore,
  InMemoryStudioSessionStore,
  InMemoryStudioTaskStore,
  InMemoryStudioWorkResultStore,
  InMemoryStudioWorkStore,
  publishRenderFailureFeedback,
  StudioBuilderRuntime,
  StudioRunProcessor,
  StudioToolRegistry,
  defaultRulesForLevel,
  evaluatePermission,
  determineStudioAgentLoopAction,
  parseSkillDocument,
  resolveWorkspacePath,
  syncRenderWorkFromTask,
  type StudioAssistantMessage,
  type StudioRuntimeBackedToolContext,
  type StudioTurnPlanResolver,
  WorkspacePathError
} from '../index'
import { getDefaultStudioWorkspacePath } from '../workspace/default-studio-workspace'
import { createStudioDefaultTurnPlanResolver } from '../runtime/planning/default-turn-plan-resolver'
import { createStudioError, createStudioSuccess } from '../../routes/helpers/studio-agent-responses'
import { parseStudioTurnIntent } from '../runtime/planning/turn-plan-intent'

import { createTestRuntime, createWorkspace, run, findLastAssistantMessageWithTool } from './run-tests.factories'
import path from 'node:path'
import { mkdir, writeFile } from 'node:fs/promises'

async function main() {
  await run('studio route helpers build stable envelopes', async () => {
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

  await run('default L2 permission rules allow skill loading', async () => {
    assert.equal(evaluatePermission(defaultRulesForLevel('L2'), 'skill', 'math-education-visualization'), 'allow')
    assert.equal(evaluatePermission(defaultRulesForLevel('L3'), 'skill', 'math-education-visualization'), 'allow')
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

  await run('terminal session events flush into assistant updates', async () => {
    const sessionId = 'sess_terminal_event'
    const messageStore = new InMemoryStudioMessageStore()
    const partStore = new InMemoryStudioPartStore()
    const sessionEventStore = new InMemoryStudioSessionEventStore()

    await enqueueSessionEvent({
      store: sessionEventStore,
      eventBus: new InMemoryStudioEventBus(),
      event: createRenderStatusSessionEvent({
        task: createStudioTask({
          sessionId,
          runId: 'run_terminal_event',
          type: 'render',
          status: 'completed',
          title: 'Render parabola',
          metadata: {
            jobId: 'job_terminal_event',
            result: {
              status: 'completed',
              data: {
                outputMode: 'video',
                videoUrl: '/tmp/parabola.mp4'
              },
              timestamp: Date.now()
            }
          }
        }),
        status: 'completed',
        summary: 'Render completed: Render parabola (output: /tmp/parabola.mp4, render_job_id: job_terminal_event)'
      })
    })

    const flushed = await flushTerminalSessionEventsToAssistant({
      sessionId,
      sessionEventStore,
      messageStore,
      partStore
    })

    const messages = await messageStore.listBySessionId(sessionId)
    const events = await sessionEventStore.listBySessionId(sessionId)
    const assistant = messages.find((message): message is StudioAssistantMessage => message.role === 'assistant')

    assert.equal(flushed.length, 1)
    assert.ok(assistant)
    assert.match(assistant?.parts[0] && assistant.parts[0].type === 'text' ? assistant.parts[0].text : '', /System Update/)
    assert.equal(events[0]?.status, 'consumed')
  })

  await run('session agent config reads tool choice from metadata', async () => {
    const session = createStudioSession({
      projectId: 'project-1',
      agentType: 'builder',
      title: 'Config Session',
      directory: await createWorkspace(),
      permissionLevel: 'L4',
      permissionRules: defaultRulesForLevel('L4'),
      metadata: {
        agentConfig: {
          toolChoice: 'required'
        }
      }
    })

    assert.deepEqual(getStudioSessionAgentConfig(session), { toolChoice: 'required' })
  })

  await run('turn intent maps list requests to ls at workspace root', async () => {
    const intent = parseStudioTurnIntent('please list the current workspace')

    assert.equal(intent.directTool?.toolName, 'ls')
    assert.deepEqual(intent.directTool?.input, { path: '.' })
    assert.ok(intent.requestedToolNames.includes('ls'))
  })

  await run('turn intent keeps explicit ls path intact', async () => {
    const intent = parseStudioTurnIntent('/ls src/studio-agent')

    assert.equal(intent.directTool?.toolName, 'ls')
    assert.deepEqual(intent.directTool?.input, { path: 'src/studio-agent' })
    assert.equal(intent.explicitCommand, true)
  })

  await run('registry filters tools by agent', async () => {
    const { registry } = createTestRuntime()

    const builderTools = registry.listForAgent('builder').map((tool) => tool.name)
    const reviewerTools = registry.listForAgent('reviewer').map((tool) => tool.name)

    assert.ok(builderTools.includes('task'))
    assert.ok(builderTools.includes('render'))
    assert.ok(!reviewerTools.includes('task'))
    assert.ok(reviewerTools.includes('skill'))
  })

  await run('resolver continues current running review work', async () => {
    const { resolveTurnPlan } = createTestRuntime()
    const session = createStudioSession({
      projectId: 'project-1',
      agentType: 'builder',
      title: 'Plan Session',
      directory: await createWorkspace(),
      permissionLevel: 'L4',
      permissionRules: defaultRulesForLevel('L4')
    })

    const plan = await resolveTurnPlan({
      projectId: 'project-1',
      session,
      run: {
        id: 'run_test',
        sessionId: session.id,
        status: 'pending',
        inputText: '继续补全审查结论',
        activeAgent: 'builder',
        createdAt: new Date().toISOString()
      },
      assistantMessage: {
        id: 'msg_test',
        sessionId: session.id,
        role: 'assistant',
        agent: 'builder',
        parts: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      },
      inputText: '继续补全审查结论',
      workContext: {
        sessionId: session.id,
        agent: 'builder',
        currentWork: {
          id: 'work_review',
          type: 'review',
          status: 'running',
          title: 'Architecture review'
        }
      }
    })

    assert.equal(plan.toolCalls?.length, 1)
    assert.equal(plan.toolCalls?.[0]?.toolName, 'task')
    assert.match(plan.assistantText ?? '', /延续当前正在进行的子代理工作/)
    assert.match(plan.assistantText ?? '', /当前会话存在进行中的 Work：Architecture review/)
  })

  await run('resolver injects failed render reminder', async () => {
    const { resolveTurnPlan } = createTestRuntime()
    const session = createStudioSession({
      projectId: 'project-1',
      agentType: 'builder',
      title: 'Plan Session',
      directory: await createWorkspace(),
      permissionLevel: 'L4',
      permissionRules: defaultRulesForLevel('L4')
    })

    const plan = await resolveTurnPlan({
      projectId: 'project-1',
      session,
      run: {
        id: 'run_test',
        sessionId: session.id,
        status: 'pending',
        inputText: '帮我继续处理',
        activeAgent: 'builder',
        createdAt: new Date().toISOString()
      },
      assistantMessage: {
        id: 'msg_test',
        sessionId: session.id,
        role: 'assistant',
        agent: 'builder',
        parts: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      },
      inputText: '帮我继续处理',
      workContext: {
        sessionId: session.id,
        agent: 'builder',
        lastRender: {
          status: 'failed',
          timestamp: Date.now(),
          error: 'LaTeX compile failed'
        }
      }
    })

    assert.match(plan.assistantText ?? '', /最近一次 render 结果失败/)
  })

  await run('runtime emits commentary before tool events when plan text is absent', async () => {
    const eventBus = new InMemoryStudioEventBus()
    const workspace = await createWorkspace()
    const { runtime, sessionStore } = createTestRuntime({
      eventBus,
      resolveTurnPlan: async () => ({
        toolCalls: [
          {
            toolName: 'ls',
            callId: 'call_ls_commentary',
            input: { path: 'src' }
          }
        ]
      })
    })

    const session = await sessionStore.create(createStudioSession({
      projectId: 'project-1',
      agentType: 'builder',
      title: 'Commentary Session',
      directory: workspace,
      permissionLevel: 'L4',
      permissionRules: defaultRulesForLevel('L4')
    }))

    const result = await runtime.run({
      projectId: 'project-1',
      session,
      inputText: '看看 src 目录'
    })

    const eventTypes = eventBus.list().map((event) => event.type)
    const assistantTextEvent = eventBus.list().find((event) => event.type === 'assistant_text')
    const toolStartIndex = eventTypes.indexOf('tool_input_start')
    const assistantTextIndex = eventTypes.indexOf('assistant_text')

    assert.ok(assistantTextEvent && assistantTextEvent.type === 'assistant_text')
    assert.match(assistantTextEvent && assistantTextEvent.type === 'assistant_text' ? assistantTextEvent.text : '', /我先看一下 src 的目录结构/)
    assert.ok(assistantTextIndex >= 0)
    assert.ok(toolStartIndex >= 0)
    assert.ok(assistantTextIndex < toolStartIndex)
  })
  await run('run processor switches assistant messages between provider turns', async () => {
    const messageStore = new InMemoryStudioMessageStore()
    const partStore = new InMemoryStudioPartStore()
    const processor = new StudioRunProcessor({
      messageStore,
      partStore,
    })

    const session = createStudioSession({
      projectId: 'project-1',
      agentType: 'builder',
      title: 'Processor Session',
      directory: await createWorkspace(),
      permissionLevel: 'L4',
      permissionRules: defaultRulesForLevel('L4')
    })

    const firstAssistantMessage = await messageStore.createAssistantMessage(createStudioAssistantMessage({
      sessionId: session.id,
      agent: 'builder'
    }))
    const secondAssistantMessage = await messageStore.createAssistantMessage(createStudioAssistantMessage({
      sessionId: session.id,
      agent: 'builder'
    }))

    async function* events() {
      yield { type: 'text-start' } as const
      yield { type: 'text-delta', text: 'first turn' } as const
      yield { type: 'text-end' } as const
      yield { type: 'assistant-message-start', message: secondAssistantMessage } as const
      yield { type: 'text-start' } as const
      yield { type: 'text-delta', text: 'second turn' } as const
      yield { type: 'text-end' } as const
      yield { type: 'finish-step' } as const
    }

    const outcome = await processor.processStream({
      session,
      run: {
        id: 'run_processor_switch',
        sessionId: session.id,
        status: 'running',
        inputText: 'test',
        activeAgent: 'builder',
        createdAt: new Date().toISOString()
      },
      assistantMessage: firstAssistantMessage,
      events: events()
    })

    const refreshedFirst = await messageStore.getById(firstAssistantMessage.id)
    const refreshedSecond = await messageStore.getById(secondAssistantMessage.id)

    assert.equal(outcome, 'continue')
    assert.ok(refreshedFirst && refreshedFirst.role === 'assistant')
    assert.ok(refreshedSecond && refreshedSecond.role === 'assistant')
    assert.equal(refreshedFirst && refreshedFirst.role === 'assistant' && refreshedFirst.parts[0]?.type === 'text' ? refreshedFirst.parts[0].text : '', 'first turn')
    assert.equal(refreshedSecond && refreshedSecond.role === 'assistant' && refreshedSecond.parts[0]?.type === 'text' ? refreshedSecond.parts[0].text : '', 'second turn')
  })
  await run('resolver does not auto-call render for plain render requests', async () => {
    const { registry } = createTestRuntime()
    const resolveTurnPlan = createStudioDefaultTurnPlanResolver({
      registry,
      enabledToolNames: ['skill', 'task', 'read', 'glob', 'grep', 'ls', 'render']
    })
    const session = createStudioSession({
      projectId: 'project-1',
      agentType: 'builder',
      title: 'Render Guard Session',
      directory: await createWorkspace(),
      permissionLevel: 'L4',
      permissionRules: defaultRulesForLevel('L4')
    })

    const plan = await resolveTurnPlan({
      projectId: 'project-1',
      session,
      run: {
        id: 'run_render_guard',
        sessionId: session.id,
        status: 'pending',
        inputText: '请直接渲染当前内容',
        activeAgent: 'builder',
        createdAt: new Date().toISOString()
      },
      assistantMessage: {
        id: 'msg_render_guard',
        sessionId: session.id,
        role: 'assistant',
        agent: 'builder',
        parts: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      },
      inputText: '请直接渲染当前内容',
      workContext: {
        sessionId: session.id,
        agent: 'builder'
      }
    })

    assert.equal(plan.toolCalls?.length ?? 0, 0)
  })

  await run('subagent prompt assembly keeps workflow separate from agent prompt', async () => {
    const prompt = buildStudioSubagentPrompt({
      agentType: 'reviewer',
      workflowInput: '请审查 @src/foo.ts 的边界条件',
      requestedSkillName: 'manim-style',
      files: ['src/foo.ts']
    })

    assert.match(prompt, /<agent_prompt role="reviewer">/)
    assert.match(prompt, /<workflow_input>/)
    assert.match(prompt, /<skill_request name="manim-style">/)
    assert.equal(extractStudioWorkflowInput(prompt), '请审查 @src/foo.ts 的边界条件')
  })

  await run('reviewer report exposes structured findings', async () => {
    const report = buildReviewerStructuredReport([
      'Review the file "sample.py".',
      '<review_target>',
      'from manim import *',
      'except Exception:',
      '    print("debug")',
      '</review_target>'
    ].join('\n'))

    assert.ok(report)
    assert.equal(report?.summary, '发现 3 个需要关注的问题')
    assert.equal(report?.findings.length, 3)
    assert.equal(report?.findings[0]?.severity, 'medium')
    assert.equal(report?.findings[0]?.code, 'manim.wildcard-import')
    assert.equal(report?.findings[0]?.path, 'sample.py')
    assert.equal(report?.findings[0]?.line, 1)
    assert.deepEqual(report?.findings[0]?.range, { start: 1, end: 1 })
  })

  await run('ai-review tool accepts change-set input and persists diff context', async () => {
    const workspace = await createWorkspace()

    const { runtime, registry, sessionStore, taskStore, workStore, workResultStore } = createTestRuntime()

    const session = await sessionStore.create(createStudioSession({
      projectId: 'project-1',
      agentType: 'builder',
      title: 'AI Review Change Set',
      directory: workspace,
      permissionLevel: 'L4',
      permissionRules: defaultRulesForLevel('L4')
    }))

    const assistantMessage = await runtime.createAssistantMessage(session)
    const runState = runtime.createRun(session, 'review changes in sample.py')
    const tool = registry.get('ai-review')
    assert.ok(tool)

    const toolContext: StudioRuntimeBackedToolContext = {
      projectId: 'project-1',
      session,
      run: runState,
      assistantMessage,
      eventBus: new InMemoryStudioEventBus(),
      taskStore,
      workStore,
      workResultStore,
      sessionStore,
      runSubagent: (input: Parameters<typeof runtime.runSubagent>[0]) => runtime.runSubagent(input)
    }

    const result = await tool!.execute({
      path: 'sample.py',
      before: 'from manim import Scene',
      after: 'from manim import *\nprint("debug")',
      diff: '@@ -1 +1,2 @@\n-from manim import Scene\n+from manim import *\n+print("debug")'
    }, toolContext)

    const works = await workStore.listBySessionId(session.id)
    const results = await workResultStore.listByWorkId(works[0].id)
    const metadata = results[0].metadata as Record<string, unknown>
    const changeSet = metadata.changeSet as Record<string, unknown>

    assert.equal(result.metadata?.reviewSourceKind, 'change-set')
    assert.equal(metadata.sourceKind, 'change-set')
    assert.equal(changeSet.before, 'from manim import Scene')
    assert.equal(changeSet.after, 'from manim import *\nprint("debug")')
    assert.match(String(changeSet.diff), /@@ -1 \+1,2 @@/)
  })
  await run('ai-review tool creates reviewer session and review report result', async () => {
    const workspace = await createWorkspace()
    await writeFile(path.join(workspace, 'sample.py'), 'from manim import *\nprint("debug")\n', 'utf8')

    const { runtime, registry, sessionStore, taskStore, workStore, workResultStore } = createTestRuntime()

    const session = await sessionStore.create(createStudioSession({
      projectId: 'project-1',
      agentType: 'builder',
      title: 'AI Review Parent',
      directory: workspace,
      permissionLevel: 'L4',
      permissionRules: defaultRulesForLevel('L4')
    }))

    const assistantMessage = await runtime.createAssistantMessage(session)
    const runState = runtime.createRun(session, 'review sample.py')
    const tool = registry.get('ai-review')
    assert.ok(tool)

    const toolContext: StudioRuntimeBackedToolContext = {
      projectId: 'project-1',
      session,
      run: runState,
      assistantMessage,
      eventBus: new InMemoryStudioEventBus(),
      taskStore,
      workStore,
      workResultStore,
      sessionStore,
      runSubagent: (input: Parameters<typeof runtime.runSubagent>[0]) => runtime.runSubagent(input)
    }

    const result = await tool!.execute({ path: 'sample.py' }, toolContext)

    const children = await sessionStore.listChildren(session.id)
    const tasks = await taskStore.listBySessionId(session.id)
    const works = await workStore.listBySessionId(session.id)
    const results = await workResultStore.listByWorkId(works[0].id)
    const findings = Array.isArray(results[0].metadata?.findings) ? results[0].metadata?.findings as Array<{ title?: string, path?: string, line?: number, code?: string }> : []

    assert.equal(children.length, 1)
    assert.equal(children[0].agentType, 'reviewer')
    assert.equal(tasks.length, 1)
    assert.equal(tasks[0].type, 'ai-review')
    assert.equal(tasks[0].status, 'completed')
    assert.equal(works.length, 1)
    assert.equal(works[0].type, 'review')
    assert.equal(works[0].status, 'completed')
    assert.equal(results.length, 1)
    assert.equal(results[0].kind, 'review-report')
    assert.equal(works[0].currentResultId, results[0].id)
    assert.match(result.output, /<review_result>/)
    assert.ok(findings.length >= 2)
    assert.equal(findings[0]?.title, '使用了通配符 Manim 导入')
    assert.equal(findings[0]?.code, 'manim.wildcard-import')
    assert.equal(findings[0]?.path, 'sample.py')
    assert.equal(findings[0]?.line, 1)
  })



  await run('task tool spawns child session and creates linked work', async () => {
    const workspace = await createWorkspace()
    const { runtime, sessionStore, taskStore, messageStore, workStore } = createTestRuntime()

    const session = await sessionStore.create(createStudioSession({
      projectId: 'project-1',
      agentType: 'builder',
      title: 'Parent',
      directory: workspace,
      permissionLevel: 'L4',
      permissionRules: defaultRulesForLevel('L4')
    }))

    await runtime.run({
      projectId: 'project-1',
      session,
      inputText: '/review architecture review :: please review this structure'
    })

    const children = await sessionStore.listChildren(session.id)
    const tasks = await taskStore.listBySessionId(session.id)
    const works = await workStore.listBySessionId(session.id)
    const assistantMessage = await findLastAssistantMessageWithTool(messageStore, session.id)
    const toolPart = assistantMessage?.parts.find((part) => part.type === 'tool')

    assert.equal(children.length, 1)
    assert.equal(tasks.length, 1)
    assert.equal(works.length, 1)
    assert.equal(tasks[0].status, 'completed')
    assert.equal(tasks[0].workId, works[0].id)
    assert.equal(works[0].type, 'review')
    assert.equal(works[0].status, 'completed')
    assert.equal(works[0].latestTaskId, tasks[0].id)
    assert.ok(toolPart && toolPart.type === 'tool' && toolPart.state.status === 'completed')
    assert.match(toolPart && toolPart.type === 'tool' ? toolPart.state.output : '', /<task_result>/)
    assert.match(toolPart && toolPart.type === 'tool' ? toolPart.state.output : '', /task_id:/)
  })

  await run('render work sync maps success into render-output result', async () => {
    const { workStore, workResultStore } = createTestRuntime()

    const work = await workStore.create(createStudioWork({
      sessionId: 'sess_test',
      runId: 'run_test',
      type: 'video',
      title: 'Render algebra',
      status: 'running'
    }))

    const task = createStudioTask({
      sessionId: 'sess_test',
      runId: 'run_test',
      workId: work.id,
      type: 'render',
      status: 'completed',
      title: 'Render algebra',
      metadata: {
        jobId: 'job_123',
        result: {
          status: 'completed',
          data: {
            outputMode: 'video',
            videoUrl: '/tmp/output.mp4',
            code: 'from manim import *',
            usedAI: true,
            quality: 'medium',
            generationType: 'ai'
          },
          timestamp: Date.now()
        }
      }
    })

    const synced = await syncRenderWorkFromTask({ workStore, workResultStore }, task)
    const results = await workResultStore.listByWorkId(work.id)

    assert.ok(synced)
    assert.equal(synced?.work.status, 'completed')
    assert.equal(synced?.work.currentResultId, results[0].id)
    assert.equal(results.length, 1)
    assert.equal(results[0].kind, 'render-output')
    assert.match(results[0].summary, /Render completed/)
    assert.equal(results[0].attachments?.[0]?.path, '/tmp/output.mp4')
  })

  await run('render work sync maps failure into failure-report result', async () => {
    const { workStore, workResultStore } = createTestRuntime()

    const work = await workStore.create(createStudioWork({
      sessionId: 'sess_test',
      runId: 'run_test',
      type: 'video',
      title: 'Render algebra',
      status: 'running'
    }))

    const task = createStudioTask({
      sessionId: 'sess_test',
      runId: 'run_test',
      workId: work.id,
      type: 'render',
      status: 'failed',
      title: 'Render algebra',
      metadata: {
        jobId: 'job_456',
        stage: 'rendering',
        result: {
          status: 'failed',
          data: {
            error: 'LaTeX compile failed',
            details: 'Missing package',
            outputMode: 'video'
          },
          timestamp: Date.now()
        }
      }
    })

    const synced = await syncRenderWorkFromTask({ workStore, workResultStore }, task)
    const results = await workResultStore.listByWorkId(work.id)

    assert.ok(synced)
    assert.equal(synced?.work.status, 'failed')
    assert.equal(results.length, 1)
    assert.equal(results[0].kind, 'failure-report')
    assert.equal(results[0].summary, 'LaTeX compile failed')
    assert.equal(results[0].metadata?.stage, 'rendering')
  })

  await run('render failure feedback writes assistant message', async () => {
    const { sessionStore, messageStore, partStore } = createTestRuntime()

    const session = await sessionStore.create(createStudioSession({
      projectId: 'project-1',
      agentType: 'builder',
      title: 'Render Session',
      directory: await createWorkspace(),
      permissionLevel: 'L4',
      permissionRules: defaultRulesForLevel('L4')
    }))

    await publishRenderFailureFeedback({
      task: createStudioTask({
        sessionId: session.id,
        runId: 'run_test',
        type: 'render',
        status: 'failed',
        title: 'Render algebra',
        metadata: {
          jobId: 'job_789',
          result: {
            status: 'failed',
            data: {
              error: 'FFmpeg missing',
              details: 'Binary not found',
              outputMode: 'video'
            },
            timestamp: Date.now()
          }
        }
      }),
      sessionStore,
      messageStore,
      partStore
    })

    const messages = await messageStore.listBySessionId(session.id)
    const assistantMessage = messages.find((message): message is StudioAssistantMessage => message.role === 'assistant')
    const textPart = assistantMessage?.parts[0]

    assert.ok(assistantMessage)
    assert.ok(textPart && textPart.type === 'text')
    assert.match(textPart && textPart.type === 'text' ? textPart.text : '', /Render task failed: Render algebra/)
    assert.match(textPart && textPart.type === 'text' ? textPart.text : '', /render_job_id: job_789/)
    assert.match(textPart && textPart.type === 'text' ? textPart.text : '', /error: FFmpeg missing/)
  })

  await run('skill tool loads local skill envelope', async () => {
    const workspace = await createWorkspace()
    const skillDir = path.join(workspace, '.manimcat', 'skills', 'demo-skill')
    await mkdir(skillDir, { recursive: true })
    await writeFile(path.join(skillDir, 'SKILL.md'), '# Demo Skill\n\nYou are a local test skill.', 'utf8')

    const { runtime, sessionStore, messageStore } = createTestRuntime()

    const session = await sessionStore.create(createStudioSession({
      projectId: 'project-1',
      agentType: 'builder',
      title: 'Skill Session',
      directory: workspace,
      permissionLevel: 'L4',
      permissionRules: defaultRulesForLevel('L4')
    }))

    await runtime.run({
      projectId: 'project-1',
      session,
      inputText: '/skill demo-skill'
    })

    const assistantMessage = await findLastAssistantMessageWithTool(messageStore, session.id)
    const toolPart = assistantMessage?.parts.find((part) => part.type === 'tool')
    assert.ok(toolPart && toolPart.type === 'tool' && toolPart.state.status === 'completed')
    const output = toolPart && toolPart.type === 'tool' && toolPart.state.status === 'completed' ? toolPart.state.output : ''
    assert.match(output, /<skill_content name="demo-skill">/)
    assert.match(output, /<skill_files>/)
  })

  await run('ls tool can access a previously loaded skill directory', async () => {
    const workspace = await createWorkspace()
    const skillDir = path.join(workspace, '.manimcat', 'skills', 'demo-skill')
    const referenceDir = path.join(skillDir, 'references')
    await mkdir(referenceDir, { recursive: true })
    await writeFile(path.join(skillDir, 'SKILL.md'), '# Demo Skill\n\nUse the references folder when needed.', 'utf8')
    await writeFile(path.join(referenceDir, 'guide.md'), 'reference text', 'utf8')

    const session = createStudioSession({
      projectId: 'project-1',
      agentType: 'builder',
      title: 'Skill Ls Session',
      directory: workspace,
      permissionLevel: 'L4',
      permissionRules: defaultRulesForLevel('L4')
    })
    const assistantMessage = createStudioAssistantMessage({
      sessionId: session.id,
      agent: 'builder'
    })
    const partStore = new InMemoryStudioPartStore()
    const skillPart = createStudioToolPart({
      messageId: assistantMessage.id,
      sessionId: session.id,
      tool: 'skill',
      callId: 'call_skill_loaded'
    })
    await partStore.create({
      ...skillPart,
      metadata: {
        directory: skillDir
      },
      state: {
        status: 'completed',
        input: { name: 'demo-skill' },
        output: '<skill_content name="demo-skill" />',
        title: 'Loaded skill: demo-skill',
        time: {
          start: Date.now(),
          end: Date.now()
        }
      }
    })

    const tool = createStudioLsTool()
    const result = await tool.execute(
      { path: skillDir },
      {
        projectId: 'project-1',
        session,
        run: createStudioRun({
          sessionId: session.id,
          inputText: '/ls',
          activeAgent: 'builder'
        }),
        assistantMessage,
        eventBus: new InMemoryStudioEventBus(),
        partStore
      } as unknown as StudioRuntimeBackedToolContext
    )

    assert.match(result.output, /dir references/)
    assert.match(result.output, /file SKILL\.md/)
    assert.equal(result.metadata?.path, '.manimcat/skills/demo-skill')
  })

  await run('ls tool can access a skill loaded by an earlier assistant message in the same run', async () => {
    const workspace = await createWorkspace()
    const skillDir = path.join(workspace, '.manimcat', 'skills', 'demo-skill')
    const referenceDir = path.join(skillDir, 'references')
    await mkdir(referenceDir, { recursive: true })
    await writeFile(path.join(skillDir, 'SKILL.md'), '# Demo Skill\n\nUse the references folder when needed.', 'utf8')
    await writeFile(path.join(referenceDir, 'guide.md'), 'reference text', 'utf8')

    const session = createStudioSession({
      projectId: 'project-1',
      agentType: 'builder',
      title: 'Skill Ls Cross Message Session',
      directory: workspace,
      permissionLevel: 'L4',
      permissionRules: defaultRulesForLevel('L4')
    })
    const runState = createStudioRun({
      sessionId: session.id,
      inputText: '/ls',
      activeAgent: 'builder'
    })
    const messageStore = new InMemoryStudioMessageStore()
    const priorAssistantMessage = await messageStore.createAssistantMessage(createStudioAssistantMessage({
      sessionId: session.id,
      agent: 'builder',
      metadata: {
        runId: runState.id
      }
    }))
    const currentAssistantMessage = await messageStore.createAssistantMessage(createStudioAssistantMessage({
      sessionId: session.id,
      agent: 'builder',
      metadata: {
        runId: runState.id
      }
    }))
    const partStore = new InMemoryStudioPartStore()
    const skillPart = createStudioToolPart({
      messageId: priorAssistantMessage.id,
      sessionId: session.id,
      tool: 'skill',
      callId: 'call_skill_loaded_prior_message'
    })
    await partStore.create({
      ...skillPart,
      metadata: {
        directory: skillDir
      },
      state: {
        status: 'completed',
        input: { name: 'demo-skill' },
        output: '<skill_content name="demo-skill" />',
        title: 'Loaded skill: demo-skill',
        time: {
          start: Date.now(),
          end: Date.now()
        }
      }
    })

    const tool = createStudioLsTool()
    const result = await tool.execute(
      { path: skillDir },
      {
        projectId: 'project-1',
        session,
        run: runState,
        assistantMessage: currentAssistantMessage,
        eventBus: new InMemoryStudioEventBus(),
        messageStore,
        partStore
      } as unknown as StudioRuntimeBackedToolContext
    )

    assert.match(result.output, /dir references/)
    assert.match(result.output, /file SKILL\.md/)
    assert.equal(result.metadata?.path, '.manimcat/skills/demo-skill')
  })

  await run('permission rules deny blocked skill runs without approval flow', async () => {
    const workspace = await createWorkspace()
    const skillDir = path.join(workspace, '.manimcat', 'skills', 'blocked-skill')
    await mkdir(skillDir, { recursive: true })
    await writeFile(path.join(skillDir, 'SKILL.md'), '# Blocked Skill\n\nShould require permission.', 'utf8')

    const { runtime, sessionStore, messageStore } = createTestRuntime()

    const session = await sessionStore.create(createStudioSession({
      projectId: 'project-1',
      agentType: 'builder',
      title: 'Permission Session',
      directory: workspace,
      permissionLevel: 'L1',
      permissionRules: defaultRulesForLevel('L1')
    }))

    const result = await runtime.run({
      projectId: 'project-1',
      session,
      inputText: '/skill blocked-skill'
    })

    const assistantMessage = await findLastAssistantMessageWithTool(messageStore, session.id)
    const toolPart = assistantMessage?.parts.find((part) => part.type === 'tool')

    assert.equal(result.run.status, 'failed')
    assert.ok(toolPart && toolPart.type === 'tool' && toolPart.state.status === 'error')
    assert.match(
      toolPart && toolPart.type === 'tool' && toolPart.state.status === 'error' ? toolPart.state.error : '',
      /interactive approval is no longer supported|Permission denied/
    )
  })

  console.log('All studio-agent tests passed')
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })
