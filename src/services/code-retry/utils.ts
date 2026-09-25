import type { CodePatch, CodePatchSet } from './types'

function stripCodeFence(text: string): string {
  return text
    .replace(/^```(?:json|text)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim()
}

function trimPatchBoundary(text: string): string {
  return text
    .replace(/^\s*\r?\n/, '')
    .replace(/\r?\n\s*$/, '')
    .replace(/\r\n/g, '\n')
}

export function parsePatchResponse(text: string): CodePatchSet {
  const normalized = stripCodeFence(text)
  if (!normalized) {
    throw new Error('Code retry patch response was empty')
  }

  if (/^\s*<!DOCTYPE\s+html/i.test(normalized) || /^\s*<html/i.test(normalized)) {
    throw new Error('Code retry patch response was HTML, not patch text')
  }

  const hasPatchMarkers =
    normalized.includes('[[PATCH]]') ||
    normalized.includes('[[SEARCH]]') ||
    normalized.includes('[[REPLACE]]') ||
    normalized.includes('[[END]]')

  if (!hasPatchMarkers) {
    throw new Error('Code retry patch response did not contain any [[PATCH]] blocks')
  }

  const patches: CodePatch[] = []
  let cursor = 0

  while (true) {
    const patchStart = normalized.indexOf('[[PATCH]]', cursor)
    if (patchStart < 0) {
      break
    }

    const searchStart = normalized.indexOf('[[SEARCH]]', patchStart + '[[PATCH]]'.length)
    if (searchStart < 0) {
      throw new Error('Code retry patch block missing [[SEARCH]] marker')
    }

    const replaceStart = normalized.indexOf('[[REPLACE]]', searchStart + '[[SEARCH]]'.length)
    if (replaceStart < 0) {
      throw new Error('Code retry patch block missing [[REPLACE]] marker')
    }

    const endStart = normalized.indexOf('[[END]]', replaceStart + '[[REPLACE]]'.length)
    if (endStart < 0) {
      throw new Error('Code retry patch block missing [[END]] marker')
    }

    const originalSnippet = trimPatchBoundary(
      normalized.slice(searchStart + '[[SEARCH]]'.length, replaceStart)
    )
    const replacementSnippet = trimPatchBoundary(
      normalized.slice(replaceStart + '[[REPLACE]]'.length, endStart)
    )

    if (!originalSnippet) {
      throw new Error('Code retry patch block missing SEARCH content')
    }

    if (originalSnippet === replacementSnippet) {
      throw new Error('Code retry patch produced no change')
    }

    patches.push({ originalSnippet, replacementSnippet })
    cursor = endStart + '[[END]]'.length
  }

  if (patches.length === 0) {
    throw new Error('Code retry patch response missing patches')
  }

  return { patches }
}

function getLineNumberAtIndex(text: string, index: number): number {
  return text.slice(0, index).split('\n').length
}

export function extractTargetLine(errorMessage: string): number | undefined {
  const match = errorMessage.match(/line\s+(\d+)/i) || errorMessage.match(/:(\d+)(?::\d+)?/)
  if (!match) {
    return undefined
  }

  const line = Number.parseInt(match[1], 10)
  return Number.isFinite(line) && line > 0 ? line : undefined
}

export function applyPatchToCode(code: string, patch: CodePatch, targetLine?: number): string {
  const matches: number[] = []
  let searchIndex = 0

  while (true) {
    const foundAt = code.indexOf(patch.originalSnippet, searchIndex)
    if (foundAt < 0) {
      break
    }
    matches.push(foundAt)
    searchIndex = foundAt + Math.max(1, patch.originalSnippet.length)
  }

  if (matches.length === 0) {
    throw new Error('Code retry patch original_snippet not found in code')
  }

  const bestIndex =
    typeof targetLine === 'number'
      ? matches.reduce((best, current) => {
          const bestDistance = Math.abs(getLineNumberAtIndex(code, best) - targetLine)
          const currentDistance = Math.abs(getLineNumberAtIndex(code, current) - targetLine)
          return currentDistance < bestDistance ? current : best
        })
      : matches[0]

  return `${code.slice(0, bestIndex)}${patch.replacementSnippet}${code.slice(bestIndex + patch.originalSnippet.length)}`
}

export function applyPatchSetToCode(code: string, patchSet: CodePatchSet, targetLine?: number): string {
  return patchSet.patches.reduce((currentCode, patch, index) => {
    const lineHint = index === 0 ? targetLine : undefined
    return applyPatchToCode(currentCode, patch, lineHint)
  }, code)
}

export function getErrorType(stderr: string): string {
  if (!stderr) return 'Unknown'

  const errorPatterns = [
    { name: 'NameError', pattern: /NameError/i },
    { name: 'SyntaxError', pattern: /SyntaxError/i },
    { name: 'AttributeError', pattern: /AttributeError/i },
    { name: 'ImportError', pattern: /ImportError/i },
    { name: 'TypeError', pattern: /TypeError/i },
    { name: 'ValueError', pattern: /ValueError/i },
    { name: 'RuntimeError', pattern: /RuntimeError/i },
    { name: 'IndentationError', pattern: /IndentationError/i }
  ]

  for (const { name, pattern } of errorPatterns) {
    if (pattern.test(stderr)) {
      return name
    }
  }

  return 'Unknown'
}

export function extractErrorMessage(stderr: string): string {
  if (!stderr) return 'Unknown error'

  const lines = stderr.trim().split('\n')
  const lastLine = lines[lines.length - 1]?.trim()

  return lastLine || stderr.slice(0, 500)
}

export function extractErrorContext(stderr: string, maxLength = 3000): string {
  if (!stderr) return 'Unknown error'

  const normalized = stderr.replace(/\r\n/g, '\n').trim()
  if (normalized.length <= maxLength) {
    return normalized
  }
  return `...[traceback truncated]\n${normalized.slice(-maxLength)}`
}
