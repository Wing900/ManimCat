import type { StudioAgentType, StudioKind, StudioWorkContext } from '../domain/types'
import type { StudioTurnPolicyDecision } from './turn-plan-policy'
import { getStudioExecutionPolicy } from '../orchestration/studio-execution-policy'

interface InsertStudioRemindersInput {
  assistantText?: string
  agentType: StudioAgentType
  studioKind?: StudioKind
  unsupportedRequestedTools: string[]
  workContext?: StudioWorkContext
  policyDecision: StudioTurnPolicyDecision
}

export function insertStudioReminders(input: InsertStudioRemindersInput): string | undefined {
  const baseText = input.assistantText?.trim()
  const reminders = buildReminders(input)

  if (!baseText) {
    return reminders.length ? reminders.join('\n') : undefined
  }

  if (!reminders.length) {
    return baseText
  }

  return [baseText, ...reminders].join('\n')
}

function buildReminders(input: InsertStudioRemindersInput): string[] {
  const reminders: string[] = []
  const policy = getStudioExecutionPolicy(input.studioKind ?? 'manim')

  if (input.agentType === 'builder' && input.policyDecision.mode === 'continue-current-work' && input.workContext?.currentWork) {
    reminders.push(policy.builderReminderTexts.runningWork(input.workContext.currentWork.title))
  }

  if (input.agentType === 'builder' && input.workContext?.lastRender?.status === 'failed') {
    reminders.push(policy.builderReminderTexts.failedRender)
  }

  if (input.workContext?.pendingEvents?.length) {
    const latestEvents = input.workContext.pendingEvents.slice(0, 3).map((event) => event.summary)
    reminders.push(policy.builderReminderTexts.pendingEvents(latestEvents))
  }

  if (input.unsupportedRequestedTools.length) {
    reminders.push(policy.builderReminderTexts.unsupportedTools(input.unsupportedRequestedTools))
  }

  return reminders
}
