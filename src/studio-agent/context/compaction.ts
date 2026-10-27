import type OpenAI from 'openai'
import type { StudioAssistantMessage, StudioMessage } from '../domain/types'
import { estimateStudioMessagesTokens } from './context-budget'

export interface StudioCompactionMetadata {
  firstKeptMessageId: string
  tokensBefore: number
  model: string
}

export interface StudioStoredConversationSelection {
  summary?: string
  firstKeptMessageId?: string
  messages: StudioMessage[]
}

export interface StudioCompactionPlan {
  prefixMessages: OpenAI.Chat.Completions.ChatCompletionMessageParam[]
  keptMessages: OpenAI.Chat.Completions.ChatCompletionMessageParam[]
  keptSourceMessageIds: Array<string | undefined>
  firstKeptMessageId: string
}

export class StudioContextWindowError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'StudioContextWindowError'
  }
}

export class StudioCompactionBoundaryError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'StudioCompactionBoundaryError'
  }
}

export function isStudioCompactionMessage(message: StudioMessage): boolean {
  return message.role === 'assistant' && readStudioCompactionMetadata(message) !== null
}

export function readStudioCompactionMetadata(message: StudioMessage): StudioCompactionMetadata | null {
  if (message.role !== 'assistant') {
    return null
  }

  return readCompactionMetadataValue(message.metadata?.compaction)
}

export function findLatestStudioCompaction(messages: readonly StudioMessage[]): StudioAssistantMessage | null {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]
    if (message.role === 'assistant' && readStudioCompactionMetadata(message)) {
      return message
    }
  }
  return null
}

/**
 * A stored conversation is the latest summary plus the original message suffix at its boundary.
 * Compaction records are control records, never provider messages, so every one is filtered out.
 */
export function selectStudioStoredConversation(messages: readonly StudioMessage[]): StudioStoredConversationSelection {
  const compaction = findLatestStudioCompaction(messages)
  if (!compaction) {
    return { messages: messages.filter((message) => !isStudioCompactionMessage(message)) }
  }

  const metadata = readStudioCompactionMetadata(compaction)
  const boundaryIndex = metadata
    ? messages.findIndex((message) => message.id === metadata.firstKeptMessageId)
    : -1
  // A summary whose retained suffix is no longer in storage cannot be applied: keeping it next to
  // the full history would duplicate content, and slicing after the record would lose messages.
  // Rebuild from the full raw history instead, ignoring the unusable summary.
  if (boundaryIndex < 0) {
    return { messages: messages.filter((message) => !isStudioCompactionMessage(message)) }
  }

  return {
    summary: compaction.summary,
    firstKeptMessageId: metadata?.firstKeptMessageId,
    messages: messages.slice(boundaryIndex).filter((message) => !isStudioCompactionMessage(message)),
  }
}

/**
 * Selects an old prefix to summarize and a recent suffix to keep. The cut is always between whole
 * user/assistant exchanges, and a tool-call group (assistant + all its tool results) never splits.
 * A latest exchange that cannot fit the context at all is an explicit error, never a mid-tool cut.
 */
export function selectStudioCompactionPlan(input: {
  conversation: readonly OpenAI.Chat.Completions.ChatCompletionMessageParam[]
  sourceMessageIds: readonly (string | undefined)[]
  keepRecentTokens: number
  contextLimitTokens: number
}): StudioCompactionPlan {
  const entries = input.conversation
    .map((message, index) => ({
      message,
      index,
      sourceMessageId: input.sourceMessageIds[index],
    }))
    .filter((entry) => entry.message.role !== 'system')

  if (!entries.length) {
    throw new StudioContextWindowError('Studio context is over budget but the conversation has no compactable messages.')
  }

  const groups: Array<typeof entries> = []
  for (const entry of entries) {
    const previous = groups[groups.length - 1]
    if (previous && previous[0].sourceMessageId === entry.sourceMessageId) {
      previous.push(entry)
    } else {
      groups.push([entry])
    }
  }

  const turns: Array<typeof entries> = []
  for (const group of groups) {
    const startsTurn = group.some((entry) => entry.message.role === 'user')
    const openTurn = turns[turns.length - 1]
    const openTurnHasUser = Boolean(openTurn?.some((entry) => entry.message.role === 'user'))
    if (startsTurn || !openTurn || !openTurnHasUser) {
      turns.push([...group])
    } else {
      openTurn.push(...group)
    }
  }

  const latestTurnTokens = estimateStudioMessagesTokens(turns[turns.length - 1].map((entry) => entry.message))
  if (latestTurnTokens >= input.contextLimitTokens) {
    throw new StudioContextWindowError(
      `The latest Studio exchange is too large for the context window (${latestTurnTokens} >= ${input.contextLimitTokens} estimated tokens).`
    )
  }

  let keptStartTurn = turns.length - 1
  let keptTokens = latestTurnTokens
  const keepRecentTokens = Math.max(1, Math.min(input.keepRecentTokens, input.contextLimitTokens - 1))
  for (let index = turns.length - 2; index >= 0; index -= 1) {
    const turnTokens = estimateStudioMessagesTokens(turns[index].map((entry) => entry.message))
    if (keptTokens + turnTokens > keepRecentTokens) {
      break
    }
    keptStartTurn = index
    keptTokens += turnTokens
  }

  const keptStartIndex = turns[keptStartTurn][0].index
  const prefixEntries = entries.filter((entry) => entry.index < keptStartIndex)
  if (!prefixEntries.length) {
    throw new StudioContextWindowError(
      'Studio context is over budget but the entire conversation is the latest exchange; no old prefix is available to summarize.'
    )
  }

  const keptEntries = entries.filter((entry) => entry.index >= keptStartIndex)
  const firstKeptMessageId = keptEntries.find((entry) => entry.sourceMessageId)?.sourceMessageId
  if (!firstKeptMessageId) {
    throw new StudioCompactionBoundaryError(
      'The retained Studio suffix has no persisted source message id, so its compaction boundary cannot be saved.'
    )
  }

  return {
    prefixMessages: prefixEntries.map((entry) => entry.message),
    keptMessages: keptEntries.map((entry) => entry.message),
    keptSourceMessageIds: keptEntries.map((entry) => entry.sourceMessageId),
    firstKeptMessageId,
  }
}

export function buildStudioSummaryConversationMessage(
  summary: string
): OpenAI.Chat.Completions.ChatCompletionSystemMessageParam {
  return {
    role: 'system',
    content: `[STUDIO_CONTEXT_SUMMARY]\n${summary.trim()}`,
  }
}

/** A summarizer-only copy: every tool output is capped, and the original messages are untouched. */
export function truncateStudioToolOutputsForSummary(
  messages: readonly OpenAI.Chat.Completions.ChatCompletionMessageParam[],
  maxToolOutputChars = 2000
): OpenAI.Chat.Completions.ChatCompletionMessageParam[] {
  return messages.map((message) => {
    if (message.role !== 'tool') {
      return { ...message }
    }

    if (typeof message.content === 'string') {
      return { ...message, content: truncateText(message.content, maxToolOutputChars) }
    }

    if (Array.isArray(message.content)) {
      return {
        ...message,
        content: message.content.map((part) => {
          if (part.type === 'text' && typeof part.text === 'string') {
            return { ...part, text: truncateText(part.text, maxToolOutputChars) }
          }
          return { ...part }
        }),
      }
    }

    return { ...message }
  })
}

export function buildStudioCompactionSummaryPrompt(input: {
  previousSummary?: string
  messages: readonly OpenAI.Chat.Completions.ChatCompletionMessageParam[]
  maxToolOutputChars?: number
}): OpenAI.Chat.Completions.ChatCompletionMessageParam[] {
  const transcript = serializeStudioMessagesForSummary(
    truncateStudioToolOutputsForSummary(input.messages, input.maxToolOutputChars ?? 2000)
  )
  const sections = [
    input.previousSummary?.trim()
      ? `Previous summary (update it, keep still-true facts):\n${input.previousSummary.trim()}`
      : '',
    `Conversation prefix to summarize:\n${transcript}`,
  ].filter(Boolean)

  return [
    {
      role: 'system',
      content: [
        'You compact Studio Agent conversation history. Do not call tools.',
        'Return a concise factual summary with these sections:',
        'Goal, Constraints, Progress, Decisions, Next steps, CriticalContext/files.',
        'Preserve exact file paths, tool ids, errors, unresolved questions and user requirements.',
        'Do not invent facts and do not mention this summarization process.',
      ].join('\n'),
    },
    { role: 'user', content: sections.join('\n\n') },
  ]
}

function serializeStudioMessagesForSummary(
  messages: readonly OpenAI.Chat.Completions.ChatCompletionMessageParam[]
): string {
  return messages.map((message, index) => {
    const content = typeof message.content === 'string'
      ? message.content
      : message.content === null
        ? ''
        : JSON.stringify(message.content)
    const toolCalls = 'tool_calls' in message && Array.isArray(message.tool_calls)
      ? `\nTool calls: ${JSON.stringify(message.tool_calls)}`
      : ''
    const toolCallId = 'tool_call_id' in message && typeof message.tool_call_id === 'string'
      ? ` (tool_call_id: ${message.tool_call_id})`
      : ''
    return `#${index + 1} ${message.role}${toolCallId}\n${content}${toolCalls}`
  }).join('\n\n')
}

function truncateText(text: string, limit: number): string {
  if (text.length <= limit) {
    return text
  }
  const marker = `\n...[truncated ${text.length - limit} chars for summary]`
  return `${text.slice(0, Math.max(0, limit - marker.length))}${marker}`
}

function readCompactionMetadataValue(value: unknown): StudioCompactionMetadata | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null
  }

  const record = value as Record<string, unknown>
  if (
    typeof record.firstKeptMessageId !== 'string'
    || !record.firstKeptMessageId
    || typeof record.tokensBefore !== 'number'
    || !Number.isFinite(record.tokensBefore)
    || typeof record.model !== 'string'
  ) {
    return null
  }

  return {
    firstKeptMessageId: record.firstKeptMessageId,
    tokensBefore: record.tokensBefore,
    model: record.model,
  }
}
