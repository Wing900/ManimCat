import type { StudioToolDefinition, StudioToolResult } from '../domain/types'
import type { StudioRuntimeBackedToolContext } from '../runtime/tools/tool-runtime-context'

interface QuestionToolInput {
  question?: string
  details?: string
}

export function createStudioQuestionTool(): StudioToolDefinition<QuestionToolInput> {
  return {
    name: 'question',
    description: 'Ask the user for clarification.',
    category: 'question',
    permission: 'question',
    allowedAgents: ['builder', 'reviewer', 'designer'],
    requiresTask: false,
    execute: async (input, context) => executeQuestionTool(input, context as StudioRuntimeBackedToolContext)
  }
}

async function executeQuestionTool(
  input: QuestionToolInput,
  context: StudioRuntimeBackedToolContext
): Promise<StudioToolResult> {
  const question = input.question?.trim()
  if (!question) {
    throw new Error('Question tool requires "question"')
  }

  context.eventBus.publish({
    type: 'question_requested',
    sessionId: context.session.id,
    runId: context.run.id,
    question,
    details: input.details
  })

  return {
    title: 'Question requested',
    output: question,
    metadata: {
      question,
      details: input.details
    }
  }
}
