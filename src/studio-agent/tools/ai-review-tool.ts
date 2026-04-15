import {
  buildReviewerStructuredReport,
  type ReviewerReport
} from '../review/reviewer-report'
import { createStudioSession, createStudioWorkResult } from '../domain/factories'
import type { StudioToolDefinition, StudioToolResult, StudioWorkResult } from '../domain/types'
import { buildChildSessionRules } from '../permissions/policy'
import type { StudioRuntimeBackedToolContext } from '../runtime/tool-runtime-context'
import { inheritStudioSessionMetadata } from '../runtime/session-agent-config'
import { createWorkAndTask, publishWorkUpdated, updateTaskAndWork } from '../works/work-lifecycle'
import { readWorkspaceFile, toWorkspaceRelativePath, truncateToolText } from './workspace-paths'

interface AiReviewToolInput {
  path?: string
  file?: string
  text?: string
  before?: string
  after?: string
  diff?: string
}

type ReviewSourceKind = 'file' | 'inline' | 'change-set'

interface ReviewSource {
  kind: ReviewSourceKind
  label: string
  path?: string
  text: string
  before?: string
  after?: string
  diff?: string
}

export function createStudioAiReviewTool(): StudioToolDefinition<AiReviewToolInput> {
  return {
    name: 'ai-review',
    description: 'Run reviewer-agent analysis over code or text and persist a review report.',
    category: 'review',
    permission: 'ai-review',
    allowedAgents: ['builder', 'reviewer'],
    requiresTask: false,
    execute: async (input, context) => executeAiReviewTool(input, context as StudioRuntimeBackedToolContext)
  }
}

async function executeAiReviewTool(
  input: AiReviewToolInput,
  context: StudioRuntimeBackedToolContext
): Promise<StudioToolResult> {
  if (!context.sessionStore) {
    throw new Error('Ai-review tool requires a session store')
  }

  if (!context.runSubagent) {
    throw new Error('Ai-review tool requires a subagent runner')
  }

  const source = await resolveReviewSource(input, context)
  const workflowInput = buildReviewWorkflowInput(source)

  const childSession = await context.sessionStore.create(
    createStudioSession({
      projectId: context.projectId,
      workspaceId: context.session.workspaceId,
      parentSessionId: context.session.id,
      agentType: 'reviewer',
      title: `${source.label} (@reviewer subagent)`,
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
    reviewKind: 'ai-review',
    reviewSourceKind: source.kind,
    reviewerSessionId: childSession.id,
    sourcePath: source.path,
    sourceLabel: source.label
  }

  const { work, task } = await createWorkAndTask({
    context,
    work: {
      sessionId: context.session.id,
      runId: context.run.id,
      type: 'review',
      title: source.label,
      status: 'running',
      metadata: lifecycleMetadata
    },
    task: {
      sessionId: context.session.id,
      runId: context.run.id,
      type: 'ai-review',
      status: 'running',
      title: source.label,
      detail: buildReviewDetail(source),
      metadata: lifecycleMetadata
    },
    workMetadata: lifecycleMetadata
  })

  context.setToolMetadata?.({
    title: source.label,
    metadata: {
      reviewerSessionId: childSession.id,
      taskId: task?.id,
      workId: work?.id,
      path: source.path,
      reviewSourceKind: source.kind
    }
  })

  try {
    const result = await context.runSubagent({
      projectId: context.projectId,
      parentSession: context.session,
      childSession,
      description: source.label,
      inputText: workflowInput,
      subagentType: 'reviewer',
      files: source.path ? [source.path] : undefined
    })

    const report = truncateToolText(result.text.trim() || 'Reviewer returned no output.')
    const structuredReport = buildReviewerStructuredReport(workflowInput)
    const completed = await updateTaskAndWork({
      context,
      task,
      work,
      taskPatch: {
        status: 'completed',
        metadata: {
          ...(task?.metadata ?? {}),
          ...lifecycleMetadata,
          result: report.text,
          review: structuredReport
        }
      },
      workMetadata: {
        ...lifecycleMetadata,
        result: report.text,
        review: structuredReport
      }
    })

    const workResult = await createReviewWorkResult({
      context,
      workId: completed.work?.id ?? work?.id,
      summary: buildReviewSummary(source, structuredReport?.summary),
      report: report.text,
      review: structuredReport,
      source
    })

    if (completed.work && workResult && context.workStore) {
      const updatedWork = await context.workStore.update(completed.work.id, {
        currentResultId: workResult.id,
        metadata: {
          ...(completed.work.metadata ?? {}),
          currentResultId: workResult.id
        }
      })
      publishWorkUpdated(context, updatedWork ?? completed.work)
    }

    return {
      title: source.label,
      output: ['<review_result>', report.text, '</review_result>'].join('\n'),
      metadata: {
        path: source.path,
        reviewSourceKind: source.kind,
        reviewerSessionId: childSession.id,
        taskId: completed.task?.id ?? task?.id,
        workId: completed.work?.id ?? work?.id,
        workResultId: workResult?.id,
        review: structuredReport,
        findings: structuredReport?.findings ?? [],
        truncated: report.truncated
      }
    }
  } catch (error) {
    await updateTaskAndWork({
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

    throw error
  }
}

async function resolveReviewSource(input: AiReviewToolInput, context: StudioRuntimeBackedToolContext): Promise<ReviewSource> {
  if (typeof input.before === 'string' || typeof input.after === 'string' || typeof input.diff === 'string') {
    const after = typeof input.after === 'string' ? input.after : ''
    const before = typeof input.before === 'string' ? input.before : ''
    return {
      kind: 'change-set',
      label: buildChangeSetLabel(input.path ?? input.file),
      path: normalizeOptionalPath(input.path ?? input.file),
      text: after || input.text?.trim() || '',
      before,
      after,
      diff: typeof input.diff === 'string' && input.diff.trim() ? input.diff.trim() : undefined
    }
  }

  const target = input.path ?? input.file
  if (target) {
    const file = await readWorkspaceFile(context.session.directory, target)
    const relativePath = toWorkspaceRelativePath(context.session.directory, file.absolutePath).replace(/\\/g, '/')
    return {
      kind: 'file',
      label: `AI review ${relativePath}`,
      path: relativePath,
      text: file.content
    }
  }

  if (input.text?.trim()) {
    return {
      kind: 'inline',
      label: 'AI review text input',
      path: undefined,
      text: input.text.trim()
    }
  }

  throw new Error('Ai-review tool requires "path", "file", "text", or change-set input')
}

function buildReviewWorkflowInput(source: ReviewSource): string {
  const target = source.path ? `Review the file "${source.path}".` : 'Review the provided text input.'
  const sections = [
    target,
    'Focus on bug risk, behavior changes, structural mismatch, and likely render/runtime failure paths.'
  ]

  if (source.kind === 'change-set') {
    sections.push('Review mode: change-set. Prioritize behavioral changes introduced by this diff.')
    if (source.before) {
      sections.push('', '<review_before>', source.before.trim(), '</review_before>')
    }
    if (source.diff) {
      sections.push('', '<review_diff>', source.diff, '</review_diff>')
    }
  }

  sections.push('', '<review_target>', source.text.trim(), '</review_target>')
  return sections.join('\n')
}

function buildReviewSummary(source: ReviewSource, summary?: string): string {
  const prefix = source.path ? `Review report for ${source.path}` : 'Review report for inline text'
  return summary ? `${prefix}: ${summary}` : prefix
}

function buildReviewDetail(source: ReviewSource): string {
  if (source.kind === 'change-set') {
    return source.path ? `change-set:${source.path}` : 'change-set'
  }

  return source.path ?? source.text.slice(0, 200)
}

function buildChangeSetLabel(path?: string): string {
  return path ? `AI review change-set ${normalizeOptionalPath(path)}` : 'AI review change-set'
}

function normalizeOptionalPath(path?: string): string | undefined {
  return path?.replace(/\\/g, '/').trim() || undefined
}

async function createReviewWorkResult(input: {
  context: StudioRuntimeBackedToolContext
  workId?: string
  summary: string
  report: string
  review: ReviewerReport | null
  source: ReviewSource
}): Promise<StudioWorkResult | null> {
  if (!input.workId || !input.context.workResultStore) {
    return null
  }

  const result = await input.context.workResultStore.create(createStudioWorkResult({
    workId: input.workId,
    kind: 'review-report',
    summary: input.summary,
    metadata: {
      report: input.report,
      review: input.review,
      findings: input.review?.findings ?? [],
      path: input.source.path,
      sourceLabel: input.source.label,
      sourceKind: input.source.kind,
      changeSet: input.source.kind === 'change-set'
        ? {
            before: input.source.before,
            after: input.source.after,
            diff: input.source.diff
          }
        : undefined
    }
  }))

  input.context.eventBus.publish({
    type: 'work_result_updated',
    sessionId: input.context.session.id,
    runId: input.context.run.id,
    result
  })

  return result
}



