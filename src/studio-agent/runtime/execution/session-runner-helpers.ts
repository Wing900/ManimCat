import { createStudioAssistantMessage, createStudioRun } from '../../domain/factories'
import type {
  StudioKind,
  StudioMessagePart,
  StudioRun,
  StudioRuntimeTurnPlan,
  StudioSession
} from '../../domain/types'
import { buildStudioSubagentPrompt } from '../../prompts/subagent-prompt'
import type { StudioResolvedSkill } from '../tools/tool-runtime-context'

export function buildDraftRun(
  session: StudioSession,
  inputText: string,
  metadata?: Record<string, unknown>
): StudioRun {
  return createStudioRun({
    sessionId: session.id,
    inputText,
    activeAgent: session.agentType,
    metadata
  })
}

export function buildDraftAssistantMessage(session: StudioSession, runId?: string) {
  return createStudioAssistantMessage({
    sessionId: session.id,
    agent: session.agentType,
    metadata: runId ? { runId } : undefined
  })
}

export function buildSubagentPrompt(input: {
  agentType: 'reviewer' | 'designer'
  inputText: string
  files?: string[]
  skillName?: string
  skill?: StudioResolvedSkill
  studioKind?: StudioKind
}): string {
  return buildStudioSubagentPrompt({
    agentType: input.agentType,
    workflowInput: input.inputText,
    files: input.files,
    skill: input.skill,
    requestedSkillName: input.skillName,
    studioKind: input.studioKind
  })
}

export function finalizeRunState(input: {
  run: StudioRun
  outcome: 'continue' | 'stop' | 'compact'
}): StudioRun {
  return {
    ...input.run,
    status: input.outcome === 'stop' ? 'failed' : 'completed',
    completedAt: new Date().toISOString(),
    error: input.outcome === 'stop' ? 'Run stopped after tool failure or rejection' : undefined
  }
}

export function failRunState(run: StudioRun, error: string): StudioRun {
  return {
    ...run,
    status: 'failed',
    completedAt: new Date().toISOString(),
    error
  }
}

export function cancelRunState(run: StudioRun, reason: string): StudioRun {
  return {
    ...run,
    status: 'cancelled',
    completedAt: new Date().toISOString(),
    error: reason,
  }
}

export function extractLatestAssistantText(parts: StudioMessagePart[]): string {
  const textPart = [...parts].reverse().find((part) => part.type === 'text')
  return textPart?.type === 'text' ? textPart.text : ''
}

export function withResolvedPlan<T extends { plan: StudioRuntimeTurnPlan }>(input: T): T {
  return input
}



function readRunStopReason(run: StudioRun): string | undefined {
  const autonomy = run.metadata?.autonomy
  if (!autonomy || typeof autonomy !== 'object' || Array.isArray(autonomy)) {
    return undefined
  }
  const stopReason = (autonomy as Record<string, unknown>).stopReason
  return typeof stopReason === 'string' && stopReason.trim() ? stopReason : undefined
}
