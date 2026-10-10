import { getSharedModule, type PromptOverrides } from '../prompts'
import type { ChatMessage } from './code-retry/types'

interface SharedBlock {
  name: 'apiIndexModule' | 'specification'
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
  const apiIndexModule = normalizeText(getSharedModule('apiIndex', promptOverrides)).trim()
  const specification = normalizeText(getSharedModule('specification', promptOverrides)).trim()
  const blocks: SharedBlock[] = []

  if (apiIndexModule.length > 0) {
    blocks.push({ name: 'apiIndexModule', content: apiIndexModule })
  }
  if (specification.length > 0) {
    blocks.push({ name: 'specification', content: specification })
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
