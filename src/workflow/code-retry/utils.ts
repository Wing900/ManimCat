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

const PATCH_START = '[[PATCH]]'
const SEARCH_START = '[[SEARCH]]'
const REPLACE_START = '[[REPLACE]]'
const PATCH_END = '[[END]]'
const CONTROL_MARKERS = [PATCH_START, SEARCH_START, REPLACE_START, PATCH_END]

function assertNoControlMarkers(text: string, label: string): void {
  for (const marker of CONTROL_MARKERS) {
    if (text.includes(marker)) {
      throw new Error(`Code retry patch ${label} contains nested ${marker} marker`)
    }
  }
}

export function parsePatchResponse(text: string): CodePatchSet {
  const normalized = stripCodeFence(text)
  if (!normalized) {
    throw new Error('Code retry patch response was empty')
  }

  if (/^\s*<!DOCTYPE\s+html/i.test(normalized) || /^\s*<html/i.test(normalized)) {
    throw new Error('Code retry patch response was HTML, not patch text')
  }

  if (!normalized.includes(PATCH_START)) {
    throw new Error('Code retry patch response did not contain any [[PATCH]] blocks')
  }

  const patches: CodePatch[] = []
  let cursor = 0

  while (true) {
    const patchStart = normalized.indexOf(PATCH_START, cursor)
    if (patchStart < 0) {
      break
    }

    let hunkCursor = patchStart + PATCH_START.length
    let hunkCount = 0

    while (true) {
      const searchStart = normalized.indexOf(SEARCH_START, hunkCursor)
      const blockEnd = normalized.indexOf(PATCH_END, hunkCursor)

      if (blockEnd >= 0 && (searchStart < 0 || blockEnd < searchStart)) {
        if (hunkCount === 0) {
          throw new Error('Code retry patch block missing [[SEARCH]] marker')
        }
        cursor = blockEnd + PATCH_END.length
        break
      }

      if (searchStart < 0) {
        throw new Error('Code retry patch block missing [[END]] marker')
      }

      const replaceStart = normalized.indexOf(REPLACE_START, searchStart + SEARCH_START.length)
      if (replaceStart < 0 || (blockEnd >= 0 && blockEnd < replaceStart)) {
        throw new Error('Code retry patch block missing [[REPLACE]] marker')
      }

      const afterReplace = replaceStart + REPLACE_START.length
      const nextSearch = normalized.indexOf(SEARCH_START, afterReplace)
      const nextEnd = normalized.indexOf(PATCH_END, afterReplace)
      const nextPatch = normalized.indexOf(PATCH_START, afterReplace)

      if (nextPatch >= 0 && (nextEnd < 0 || nextPatch < nextEnd) && (nextSearch < 0 || nextPatch < nextSearch)) {
        throw new Error('Code retry patch block missing [[END]] marker')
      }

      const replacementEnd = nextEnd >= 0 && (nextSearch < 0 || nextEnd < nextSearch)
        ? nextEnd
        : nextSearch

      if (replacementEnd < 0) {
        throw new Error('Code retry patch block missing [[END]] marker')
      }

      const originalSnippet = trimPatchBoundary(
        normalized.slice(searchStart + SEARCH_START.length, replaceStart)
      )
      const replacementSnippet = trimPatchBoundary(
        normalized.slice(afterReplace, replacementEnd)
      )

      if (!originalSnippet) {
        throw new Error('Code retry patch block missing SEARCH content')
      }

      assertNoControlMarkers(originalSnippet, 'SEARCH content')
      assertNoControlMarkers(replacementSnippet, 'REPLACE content')

      if (originalSnippet === replacementSnippet) {
        throw new Error('Code retry patch produced no change')
      }

      patches.push({ originalSnippet, replacementSnippet })
      hunkCount += 1
      hunkCursor = replacementEnd
    }
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

export function extractCodeContext(
  code: string,
  errorMessage: string,
  contextLines = 20,
  maxLength = 6000
): string | undefined {
  const lines = code.split(/\r?\n/)
  const sourceFrames = [...errorMessage.matchAll(/File\s+["']([^"']+\.py)["'],\s+line\s+(\d+)/gi)]
  const projectFrame = sourceFrames.find((match) =>
    !/[\\/](?:site-packages|dist-packages|manim|manimgx)[\\/]/i.test(match[1]) &&
    !/(?:^|[\\/])manimgx-runner\.py$/i.test(match[1])
  )
  const richFrame = errorMessage.match(/[│|]\s*(?:❱|>)\s*(\d+)\s+/)
  const candidate = projectFrame?.[2] || richFrame?.[1]
  const targetLine = candidate ? Number.parseInt(candidate, 10) : extractTargetLine(errorMessage)

  if (typeof targetLine !== 'number' || !Number.isFinite(targetLine) || targetLine < 1 || targetLine > lines.length) {
    return undefined
  }

  const start = Math.max(0, targetLine - contextLines - 1)
  const end = Math.min(lines.length, targetLine + contextLines)
  const snippet = lines.slice(start, end).join('\n').trim()
  if (!snippet) return undefined
  return snippet.length <= maxLength ? snippet : snippet.slice(0, maxLength)
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
    { name: 'MemoryError', pattern: /MemoryError|Unable to allocate|out of memory/i },
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
