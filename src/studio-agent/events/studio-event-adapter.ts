import type { StudioAgentEvent } from '../domain/types'

export interface StudioExternalEvent {
  type: string
  properties: Record<string, unknown>
}

export function adaptStudioEvent(event: StudioAgentEvent): StudioExternalEvent | null {
  switch (event.type) {
    case 'task_updated':
      return {
        type: 'task.updated',
        properties: {
          sessionId: event.sessionId,
          runId: event.runId,
          task: event.task
        }
      }

    case 'work_updated':
      return {
        type: 'work.updated',
        properties: {
          sessionId: event.sessionId,
          runId: event.runId,
          work: event.work
        }
      }

    case 'work_result_updated':
      return {
        type: 'work-result.updated',
        properties: {
          sessionId: event.sessionId,
          runId: event.runId,
          result: event.result
        }
      }

    case 'session_event_queued':
      return {
        type: 'session-event.queued',
        properties: {
          sessionId: event.sessionId,
          runId: event.runId,
          event: event.event
        }
      }

    case 'tool_input_start':
      return {
        type: 'tool.input-start',
        properties: {
          sessionId: event.sessionId,
          runId: event.runId,
          messageId: event.messageId,
          toolName: event.toolName,
          callId: event.callId,
          raw: event.raw
        }
      }

    case 'tool_call':
      return {
        type: 'tool.call',
        properties: {
          sessionId: event.sessionId,
          runId: event.runId,
          messageId: event.messageId,
          toolName: event.toolName,
          callId: event.callId,
          input: event.input
        }
      }

    case 'tool_result':
      return {
        type: 'tool.result',
        properties: {
          sessionId: event.sessionId,
          runId: event.runId,
          messageId: event.messageId,
          toolName: event.toolName,
          callId: event.callId,
          status: event.status,
          title: event.title,
          output: event.output,
          metadata: event.metadata,
          attachments: event.attachments,
          error: event.error
        }
      }

    case 'question_requested':
      return {
        type: 'question.requested',
        properties: {
          sessionId: event.sessionId,
          runId: event.runId,
          question: event.question,
          details: event.details
        }
      }

    case 'run_updated':
      return {
        type: 'run.updated',
        properties: {
          run: event.run
        }
      }

    case 'assistant_text':
      return {
        type: 'assistant.text',
        properties: {
          sessionId: event.sessionId,
          runId: event.runId,
          messageId: event.messageId,
          text: event.text
        }
      }

    default:
      return null
  }
}


