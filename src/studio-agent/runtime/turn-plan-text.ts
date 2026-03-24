import type { StudioAgentType, StudioKind } from '../domain/types'
import type { StudioParsedTurnIntent } from './turn-plan-intent'
import type { StudioTurnPolicyDecision } from './turn-plan-policy'
import { buildReviewerReport } from '../review/reviewer-report'
import { getStudioExecutionPolicy } from '../orchestration/studio-execution-policy'

export function buildAgentAssistantText(input: {
  agentType: StudioAgentType
  studioKind?: StudioKind
  inputText: string
  intent: StudioParsedTurnIntent
  policyDecision: StudioTurnPolicyDecision
}): string {
  switch (input.agentType) {
    case 'reviewer':
      return buildReviewerText(input.inputText, input.intent, input.studioKind)
    case 'designer':
      return buildDesignerText(input.inputText, input.intent, input.studioKind)
    case 'builder':
    default:
      return buildBuilderText(input.intent, input.policyDecision, input.studioKind)
  }
}

function buildBuilderText(
  intent: StudioParsedTurnIntent,
  policyDecision: StudioTurnPolicyDecision,
  studioKind?: StudioKind
): string {
  const policy = getStudioExecutionPolicy(studioKind ?? 'manim')

  switch (policyDecision.mode) {
    case 'continue-current-work':
      return policy.builderContinueText
    case 'task-intent':
      if (intent.task) {
        return policy.builderTaskIntentText(intent.task.subagentType, intent.task.skillName)
      }
      return policy.builderContinueText
    case 'direct-tool':
      if (intent.directTool) {
        return policy.builderDirectToolText(intent.directTool.toolName)
      }
      return policy.builderDirectToolText('tool')
    case 'none':
    default:
      return policy.builderNoPlanText(intent.explicitCommand)
  }
}

function buildReviewerText(inputText: string, intent: StudioParsedTurnIntent, studioKind?: StudioKind): string {
  const generatedReport = buildReviewerReport(inputText)
  if (generatedReport) {
    return generatedReport
  }

  const subject = summarizeInput(inputText)
  const policy = getStudioExecutionPolicy(studioKind ?? 'manim')
  const prefix = intent.skillName
    ? `I will follow skill "${intent.skillName}" while reviewing this.`
    : policy.subagentLeadText.reviewer

  return [
    prefix,
    `Review target: ${subject}`,
    'I will focus on risks, failure paths, and the most important validation steps.'
  ].join('\n')
}

function buildDesignerText(inputText: string, intent: StudioParsedTurnIntent, studioKind?: StudioKind): string {
  const subject = summarizeInput(inputText)
  const policy = getStudioExecutionPolicy(studioKind ?? 'manim')
  const prefix = intent.skillName
    ? `I will follow skill "${intent.skillName}" while designing this.`
    : policy.subagentLeadText.designer

  return [
    prefix,
    `Design target: ${subject}`,
    'I will focus on structure, implementation slices, and the safest next steps.'
  ].join('\n')
}

function summarizeInput(inputText: string): string {
  const firstContentLine = inputText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean)

  return firstContentLine?.slice(0, 120) ?? 'No concrete subject provided.'
}
