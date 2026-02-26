import { API_INDEX, SOUL_INDEX } from '../prompts/api-index'
import { getSharedModule, type PromptOverrides } from '../prompts'
import type { ChatMessage } from './code-retry/types'

interface SharedBlock {
  name: 'knowledge' | 'rules' | 'apiIndex' | 'soulIndex'
  content: string
}

function normalizeText(text: string): string {
  return text.replace(/\r\n/g, '\n')
}

function normalizePromptWhitespace(text: string): string {
  return normalizeText(text)
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function removeAllOccurrences(text: string, fragment: string): string {
  if (!fragment) {
    return text
  }

  let output = text
  while (true) {
    const index = output.indexOf(fragment)
    if (index < 0) {
      return output
    }
    output = output.slice(0, index) + output.slice(index + fragment.length)
  }
}

function removeDuplicateOccurrences(text: string, fragment: string): string {
  if (!fragment) {
    return text
  }

  const firstIndex = text.indexOf(fragment)
  if (firstIndex < 0) {
    return text
  }

  const head = text.slice(0, firstIndex + fragment.length)
  const tail = text.slice(firstIndex + fragment.length)
  return head + removeAllOccurrences(tail, fragment)
}

function buildSharedBlocks(promptOverrides?: PromptOverrides): SharedBlock[] {
  const knowledge = normalizeText(getSharedModule('knowledge', promptOverrides)).trim()
  const rules = normalizeText(getSharedModule('rules', promptOverrides)).trim()
  const apiIndex = normalizeText(API_INDEX).trim()
  const soulIndex = normalizeText(SOUL_INDEX).trim()
  const blocks: SharedBlock[] = []

  if (knowledge.length > 0) {
    blocks.push({ name: 'knowledge', content: knowledge })
  }
  if (rules.length > 0) {
    blocks.push({ name: 'rules', content: rules })
  }
  if (apiIndex.length > 0) {
    blocks.push({ name: 'apiIndex', content: apiIndex })
  }
  if (soulIndex.length > 0) {
    blocks.push({ name: 'soulIndex', content: soulIndex })
  }

  return blocks
}

export function stripSharedBlocksFromPrompt(content: string, promptOverrides?: PromptOverrides): string {
  const blocks = buildSharedBlocks(promptOverrides)
  let output = normalizeText(content)

  for (const block of blocks) {
    output = removeAllOccurrences(output, block.content)
  }

  return normalizePromptWhitespace(output)
}

export function dedupeSharedBlocksInMessages(
  messages: ChatMessage[],
  promptOverrides?: PromptOverrides
): ChatMessage[] {
  const blocks = buildSharedBlocks(promptOverrides)
  const seenBlocks = new Set<SharedBlock['name']>()
  const deduped: ChatMessage[] = []

  for (const message of messages) {
    let content = normalizeText(message.content)

    for (const block of blocks) {
      if (seenBlocks.has(block.name)) {
        content = removeAllOccurrences(content, block.content)
        continue
      }

      if (content.includes(block.content)) {
        content = removeDuplicateOccurrences(content, block.content)
        seenBlocks.add(block.name)
      }
    }

    const normalized = normalizePromptWhitespace(content)
    if (!normalized) {
      continue
    }

    deduped.push({
      role: message.role,
      content: normalized
    })
  }

  return deduped
}
