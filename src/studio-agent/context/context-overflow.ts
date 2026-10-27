/**
 * Recognizes a provider context-window overflow. Anything else - including timeouts and gateway
 * 504s - is deliberately not classified as compaction material.
 */
const CONTEXT_OVERFLOW_PATTERN = new RegExp([
  'context[_ ]length[_ ]exceeded',
  'maximum context length',
  'context window',
  'too many tokens',
  'reduce the length of the messages',
  'prompt is too long',
  'input is too long',
  'exceeds? (?:the )?(?:model\'s )?(?:maximum )?context',
].join('|'), 'i')

export function isStudioContextOverflowError(error: unknown): boolean {
  const evidence: string[] = []
  collectErrorEvidence(error, evidence, 0, new Set())
  return CONTEXT_OVERFLOW_PATTERN.test(evidence.join(' '))
}

function collectErrorEvidence(value: unknown, evidence: string[], depth: number, seen: Set<object>): void {
  if (depth > 4 || value === null || value === undefined) {
    return
  }

  if (typeof value === 'string' || typeof value === 'number') {
    evidence.push(String(value))
    return
  }

  if (typeof value !== 'object' || seen.has(value)) {
    return
  }
  seen.add(value)

  if (value instanceof Error) {
    evidence.push(value.name, value.message)
  }

  const record = value as Record<string, unknown>
  for (const key of ['code', 'type', 'param', 'status', 'message', 'error', 'cause', 'response', 'body']) {
    if (key in record) {
      collectErrorEvidence(record[key], evidence, depth + 1, seen)
    }
  }
}
