import type { TranslationKey } from '../../../i18n/messages'
import type {
  StudioSceneAttachment,
  StudioSceneMessage,
  StudioScenePart,
} from '../../protocol/studio-agent-types'

/**
 * Conversation rows of one Scene (task 11C2), derived purely from the Scene public messages.
 *
 * The Scene projection is already sanitized by the backend: a Tool part carries a display name, a
 * public status, a safe title, a presentation summary and public attachments — never the model's raw
 * arguments, an internal error, a stack trace or a private path. This module therefore only decides
 * *shape*: what is one row, what is folded, and what is never rendered.
 */

export type StudioCinemaToolDisplayStatus = 'pending' | 'running' | 'completed' | 'failed'

export interface StudioCinemaUserRow {
  kind: 'user'
  id: string
  text: string
  at: string
}

export interface StudioCinemaAssistantTextRow {
  kind: 'assistant-text'
  id: string
  text: string
  at: string
}

export interface StudioCinemaReasoningRow {
  kind: 'reasoning'
  id: string
  text: string
  at: string
}

export interface StudioCinemaToolRow {
  kind: 'tool'
  id: string
  callId: string
  toolName: string
  status: StudioCinemaToolDisplayStatus
  /** Safe one-line title from the public projection, when the Tool produced one. */
  title: string | null
  /** Public summary of the result; only shown when the row is expanded. */
  output: string | null
  attachments: StudioSceneAttachment[]
  /** True when expanding the row reveals anything at all. */
  hasDetail: boolean
}

export type StudioCinemaConversationRow =
  | StudioCinemaUserRow
  | StudioCinemaAssistantTextRow
  | StudioCinemaReasoningRow
  | StudioCinemaToolRow

export function readStudioCinemaToolStatusKey(status: StudioCinemaToolDisplayStatus): TranslationKey {
  switch (status) {
    case 'pending':
      return 'studio.cinema.toolStatusPending'
    case 'running':
      return 'studio.cinema.toolStatusRunning'
    case 'completed':
      return 'studio.cinema.toolStatusCompleted'
    case 'failed':
      return 'studio.cinema.toolStatusFailed'
  }
}

/** The public Tool status vocabulary maps onto the UI's; an unknown state is shown as running. */
export function readStudioCinemaToolDisplayStatus(status: string): StudioCinemaToolDisplayStatus {
  switch (status) {
    case 'pending':
      return 'pending'
    case 'completed':
      return 'completed'
    case 'error':
      // The public projection says `error`; the UI says `failed` and shows no error text.
      return 'failed'
    default:
      return 'running'
  }
}

function readStudioCinemaPartRows(part: StudioScenePart, at: string): StudioCinemaConversationRow[] {
  if (part.type === 'text') {
    const text = part.text.trim()
    return text.length > 0 ? [{ kind: 'assistant-text', id: part.id, text: part.text, at }] : []
  }

  if (part.type === 'reasoning') {
    const text = part.text.trim()
    // Reasoning is folded and never floods the transcript; an empty one is not a row at all.
    return text.length > 0 ? [{ kind: 'reasoning', id: part.id, text: part.text, at }] : []
  }

  const output = part.state.output?.trim() ? part.state.output : null
  const title = part.state.title?.trim() ? part.state.title : null
  const attachments = part.state.attachments ?? []

  return [
    {
      kind: 'tool',
      id: part.id,
      callId: part.callId,
      toolName: part.tool,
      status: readStudioCinemaToolDisplayStatus(part.state.status),
      title,
      output,
      attachments,
      hasDetail: Boolean(title || output || attachments.length),
    },
  ]
}

/** Flattens Scene messages into display rows, stable by id, in the order the server returned them. */
export function readStudioCinemaConversationRows(
  messages: readonly StudioSceneMessage[]
): StudioCinemaConversationRow[] {
  const rows: StudioCinemaConversationRow[] = []

  for (const message of messages) {
    if (message.role === 'user') {
      rows.push({ kind: 'user', id: message.id, text: message.text, at: message.createdAt })
      continue
    }

    for (const part of message.parts) {
      rows.push(...readStudioCinemaPartRows(part, message.createdAt))
    }
  }

  return rows
}

/** Number of Tool rows, used for the collapsed "N activities" summary of the history panel. */
export function countStudioCinemaToolRows(rows: readonly StudioCinemaConversationRow[]): number {
  return rows.filter((row) => row.kind === 'tool').length
}

/** True when a Scene has nothing worth opening the history panel for. */
export function isStudioCinemaConversationEmpty(rows: readonly StudioCinemaConversationRow[]): boolean {
  return rows.length === 0
}
