import type { ManimApiRequest } from '../manim-api'
import { extractTargetLine } from './utils'

const IDENTIFIER = '[A-Za-z_]\\w*'

function inferVariableTypes(code: string): Map<string, string> {
  const types = new Map<string, string>()
  const assignment = new RegExp(`^\\s*(${IDENTIFIER})\\s*(?::[^=]+)?=\\s*(${IDENTIFIER})\\s*\\(`)

  for (const line of code.split(/\r?\n/)) {
    const match = line.match(assignment)
    if (match && /^[A-Z]/.test(match[2])) {
      types.set(match[1], match[2])
    }
  }
  return types
}

function sourceLineFromError(code: string, errorContext: string): string | undefined {
  for (const line of errorContext.split(/\r?\n/).reverse()) {
    const richTracebackLine = line.match(/^[│|]\s*(?:❱|>)\s*\d+\s+(.*?)\s*[│|]\s*$/)
    if (richTracebackLine?.[1]) return richTracebackLine[1]
  }

  const lineNumber = extractTargetLine(errorContext)
  if (lineNumber) {
    const line = code.split(/\r?\n/)[lineNumber - 1]
    if (line?.trim()) return line
  }
  return undefined
}

function requestFor(owner: string, member: string, reason: string): ManimApiRequest {
  return {
    query: `${reason}. Verify the runtime API and find the intended callable replacement.`,
    symbols: [`${owner}.${member}`]
  }
}

/**
 * Extracts high-confidence API lookup keys from a Python traceback and its source.
 * This is deliberately syntax-oriented: the runtime catalog supplies the facts.
 */
export function inferAutomaticApiRequests(
  code: string,
  errorContext: string
): ManimApiRequest[] {
  const requests: ManimApiRequest[] = []
  const seen = new Set<string>()
  const add = (request: ManimApiRequest) => {
    const key = request.symbols[0].toLowerCase()
    if (!seen.has(key)) {
      seen.add(key)
      requests.push(request)
    }
  }

  const attributeError = errorContext.match(
    /['"]?([A-Za-z_]\w*)['"]?\s+object has no attribute\s+['"]([A-Za-z_]\w*)['"]/i
  )
  if (attributeError) {
    add(requestFor(attributeError[1], attributeError[2], 'The traceback reports a missing attribute'))
  }

  const failingLine = sourceLineFromError(code, errorContext)
  if (!failingLine) return requests

  const variableTypes = inferVariableTypes(code)
  const calls = failingLine.matchAll(
    new RegExp(`\\b(${IDENTIFIER})((?:\\.${IDENTIFIER})+)\\s*\\(`, 'g')
  )
  for (const call of calls) {
    const root = call[1]
    const chain = call[2].slice(1).split('.')
    const member = chain[chain.length - 1]
    const owner = variableTypes.get(root)
    if (owner) {
      add(requestFor(owner, member, `The failing expression is ${root}${call[2]}(...)`))
    }
  }

  return requests.slice(0, 3)
}
