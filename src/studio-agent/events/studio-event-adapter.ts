import type { StudioAgentEvent } from '../domain/types'

export interface StudioExternalEvent {
  type: string
  properties: Record<string, unknown>
}

export function adaptStudioEvent(event: StudioAgentEvent): StudioExternalEvent | null {
  switch (event.type) {
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

    case 'run_updated':
      return {
        type: 'run.updated',
        properties: {
          sessionId: event.sessionId,
          run: event.run
        }
      }

    case 'render_updated':
      return {
        type: 'render.updated',
        properties: {
          sessionId: event.sessionId,
          runId: event.runId,
          render: event.render
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


