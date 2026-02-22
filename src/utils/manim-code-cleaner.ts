/**
 * Manim code cleanup helpers.
 */

import { replaceFullwidthOutsideStrings, replaceLineWithDashedLine } from './manim-code-cleaner/rules'

type CleanupResult = {
  code: string
  changes: string[]
}

export function cleanManimCode(code: string): CleanupResult {
  let cleaned = code
  const changes: string[] = []

  if (cleaned.includes('\uFEFF')) {
    cleaned = cleaned.replace(/\uFEFF/g, '')
    changes.push('remove-bom')
  }

  if (cleaned.includes('\uFFFD')) {
    cleaned = cleaned.replace(/\uFFFD/g, '')
    changes.push('remove-replacement-char')
  }

  const fullwidthResult = replaceFullwidthOutsideStrings(cleaned)
  if (fullwidthResult.replaced > 0) {
    cleaned = fullwidthResult.code
    changes.push(`normalize-fullwidth-punctuation:${fullwidthResult.replaced}`)
  } else {
    cleaned = fullwidthResult.code
  }

  const dashedResult = replaceLineWithDashedLine(cleaned)
  if (dashedResult.changed > 0) {
    cleaned = dashedResult.code
    changes.push(`line-to-dashedline:${dashedResult.changed}`)
  }

  return { code: cleaned, changes }
}
