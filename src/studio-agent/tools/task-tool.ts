import { createStudioSession } from '../domain/factories'
import type {
  StudioToolDefinition,
  StudioToolResult,
  StudioWorkType
} from '../domain/types'
import { buildChildSessionRules } from '../permissions/policy'
import { inheritStudioSessionMetadata } from '../runtime/session/session-agent-config'
import type { StudioRuntimeBackedToolContext } from '../runtime/tools/tool-runtime-context'
import { createWorkAndTask, updateTaskAndWork } from '../works/work-lifecycle'

interface TaskToolInput {
  subagent_type: 'reviewer' | 'designer'
  description: string
  input: string
  skill?: string
  files?: string[]
}

export function createStudioTaskTool(): StudioToolDefinition<TaskToolInput> {
  return {
    name: 'task',
    description: 'Invoke a Studio subagent in a child session.',
    category: 'agent',
    permission: 'task',
    allowedAgents: ['builder'],
    requiresTask: true,
    execute: async (input, context) => executeTaskTool(input, context as StudioRuntimeBackedToolContext)
  }
}

async function executeTaskTool(
  input: TaskToolInput,
  context: StudioRuntimeBackedToolContext
): Promise<StudioToolResult> {
  if (!context.sessionStore) {
    throw new Error('Task tool requires a session store')
  }

  if (!context.runSubagent) {
    throw new Error('Task tool requires a subagent runner')
  }

  const childSession = await context.sessionStore.create(
    createStudioSession({
      projectId: context.projectId,
      workspaceId: context.session.workspaceId,
      parentSessionId: context.session.id,
      studioKind: context.session.studioKind,
      agentType: input.subagent_type,
      title: `${input.description} (@${input.subagent_type} subagent)`,
      directory: context.session.directory,
      permissionLevel: context.session.permissionLevel,
      permissionRules: buildChildSessionRules({
        parentRules: context.session.permissionRules,
        denyTask: true
      }),
      metadata: inheritStudioSessionMetadata(context.session)
    })
  )

  const lifecycleMetadata = {
    childSessionId: childSession.id,
    subagentType: input.subagent_type,
    skill: input.skill,
    files: input.files
  }

  const { work, task } = await createWorkAndTask({
    context,
    work: {
      sessionId: context.session.id,
      runId: context.run.id,
      type: getWorkType(input.subagent_type),
      title: input.description,
      status: 'running',
      metadata: lifecycleMetadata
    },
    task: {
      sessionId: context.session.id,
      runId: context.run.id,
      type: 'subagent-run',
      status: 'running',
      title: input.description,
      detail: input.input,
      metadata: lifecycleMetadata
    },
    workMetadata: lifecycleMetadata
  })

  context.setToolMetadata?.({
    title: input.description,
    metadata: {
      sessionId: childSession.id,
      taskId: task?.id,
      workId: work?.id,
      subagentType: input.subagent_type,
      skill: input.skill
    }
  })

  try {
    const result = await context.runSubagent({
      projectId: context.projectId,
      parentSession: context.session,
      childSession,
      description: input.description,
      inputText: input.input,
      subagentType: input.subagent_type,
      skillName: input.skill,
      files: input.files
    })

    const completed = await updateTaskAndWork({
      context,
      task,
      work,
      taskPatch: {
        status: 'completed',
        metadata: {
          ...(task?.metadata ?? {}),
          ...lifecycleMetadata,
          result: result.text
        }
      },
      workMetadata: {
        ...lifecycleMetadata,
        result: result.text
      }
    })

    const childText = result.text.trim()
    return {
      title: input.description,
      output: ['task_id: ' + childSession.id, '', '<task_result>', childText, '</task_result>'].join('\n'),
      metadata: {
        sessionId: childSession.id,
        taskId: completed.task?.id ?? task?.id,
        workId: completed.work?.id ?? work?.id,
        subagentType: input.subagent_type,
        skill: input.skill
      }
    }
  } catch (error) {
    const failed = await updateTaskAndWork({
      context,
      task,
      work,
      taskPatch: {
        status: 'failed',
        metadata: {
          ...(task?.metadata ?? {}),
          ...lifecycleMetadata,
          error: error instanceof Error ? error.message : String(error)
        }
      },
      workMetadata: {
        ...lifecycleMetadata,
        error: error instanceof Error ? error.message : String(error)
      }
    })

    context.setToolMetadata?.({
      title: input.description,
      metadata: {
        sessionId: childSession.id,
        taskId: failed.task?.id ?? task?.id,
        workId: failed.work?.id ?? work?.id,
        subagentType: input.subagent_type,
        error: error instanceof Error ? error.message : String(error)
      }
    })

    throw error
  }
}

function getWorkType(subagentType: TaskToolInput['subagent_type']): StudioWorkType {
  return subagentType === 'reviewer' ? 'review' : 'design'
}
