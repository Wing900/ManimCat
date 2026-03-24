import type { StudioAgentType, StudioKind, StudioPlannedToolCall, StudioWorkContext } from '../domain/types'
import type { StudioParsedTurnIntent, StudioParsedTaskIntent } from './turn-plan-intent'
import { createPlannedCallId } from './turn-plan-intent'

export type StudioTurnPolicyDecisionMode = 'continue-current-work' | 'task-intent' | 'direct-tool' | 'none'

export interface StudioTurnPolicyDecision {
  mode: StudioTurnPolicyDecisionMode
  toolCalls: StudioPlannedToolCall[]
}

interface ResolveStudioTurnPolicyInput {
  agentType: StudioAgentType
  studioKind?: StudioKind
  inputText: string
  intent: StudioParsedTurnIntent
  supportedToolNames: Set<string>
  workContext?: StudioWorkContext
}

export function resolveStudioTurnPolicy(input: ResolveStudioTurnPolicyInput): StudioTurnPolicyDecision {
  if (input.agentType === 'builder') {
    const continuedTask = buildContinuedWorkTask(input)
    if (continuedTask) {
      return {
        mode: 'continue-current-work',
        toolCalls: [continuedTask]
      }
    }

    if (input.intent.task && input.supportedToolNames.has('task')) {
      return {
        mode: 'task-intent',
        toolCalls: [buildTaskIntentCall(input.intent.task)]
      }
    }

    if (input.intent.directTool && input.supportedToolNames.has(input.intent.directTool.toolName)) {
      return {
        mode: 'direct-tool',
        toolCalls: [
          {
            toolName: input.intent.directTool.toolName,
            callId: createPlannedCallId(input.intent.directTool.toolName),
            input: input.intent.directTool.input
          }
        ]
      }
    }

    return {
      mode: 'none',
      toolCalls: []
    }
  }

  if (input.intent.directTool && input.supportedToolNames.has(input.intent.directTool.toolName)) {
    return {
      mode: 'direct-tool',
      toolCalls: [
        {
          toolName: input.intent.directTool.toolName,
          callId: createPlannedCallId(input.intent.directTool.toolName),
          input: input.intent.directTool.input
        }
      ]
    }
  }

  return {
    mode: 'none',
    toolCalls: []
  }
}

function buildContinuedWorkTask(input: ResolveStudioTurnPolicyInput): StudioPlannedToolCall | undefined {
  const currentWork = input.workContext?.currentWork
  if (!currentWork) {
    return undefined
  }

  if (input.intent.explicitCommand) {
    return undefined
  }

  if (currentWork.status !== 'running') {
    return undefined
  }

  if (currentWork.type !== 'review' && currentWork.type !== 'design') {
    return undefined
  }

  if (!input.supportedToolNames.has('task')) {
    return undefined
  }

  return {
    toolName: 'task',
    callId: createPlannedCallId('task'),
    input: {
      subagent_type: currentWork.type === 'review' ? 'reviewer' : 'designer',
      description: `Continue ` + currentWork.type + ': ' + currentWork.title,
      input: input.inputText
    }
  }
}

function buildTaskIntentCall(task: StudioParsedTaskIntent): StudioPlannedToolCall {
  return {
    toolName: 'task',
    callId: createPlannedCallId('task'),
    input: {
      subagent_type: task.subagentType,
      description: task.description,
      input: task.input,
      skill: task.skillName,
      files: task.files
    }
  }
}
