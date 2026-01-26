/**
 * Manim code cleanup helpers.
 */

type CleanupResult = {
  code: string
  changes: string[]
}

const FULLWIDTH_PUNCTUATION_MAP: Record<string, string> = {
  '\uFF0C': ',',
  '\u3001': ',',
  '\u3002': '.',
  '\uFF1B': ';',
  '\uFF1A': ':',
  '\uFF08': '(',
  '\uFF09': ')',
  '\u3010': '[',
  '\u3011': ']',
  '\u300C': '"',
  '\u300D': '"',
  '\u300E': '"',
  '\u300F': '"',
  '\u201C': '"',
  '\u201D': '"',
  '\u2018': "'",
  '\u2019': "'",
  '\uFF01': '!',
  '\uFF1F': '?',
  '\uFF05': '%',
  '\uFF0B': '+',
  '\uFF1D': '=',
  '\uFF0D': '-',
  '\u2013': '-',
  '\u2014': '-',
  '\uFF5E': '~'
}

function isIdentifierChar(value: string | undefined): boolean {
  return !!value && /[A-Za-z0-9_]/.test(value)
}

function replaceFullwidthOutsideStrings(code: string): { code: string; replaced: number } {
  let result = ''
  let replaced = 0
  let i = 0
  let inSingle = false
  let inDouble = false
  let inTripleSingle = false
  let inTripleDouble = false
  let inComment = false

  while (i < code.length) {
    const ch = code[i]
    const nextThree = code.slice(i, i + 3)

    if (inComment) {
      result += ch
      if (ch === '\n') {
        inComment = false
      }
      i += 1
      continue
    }

    if (!inSingle && !inDouble && !inTripleSingle && !inTripleDouble) {
      if (nextThree === "'''" && !inDouble) {
        inTripleSingle = true
        result += nextThree
        i += 3
        continue
      }
      if (nextThree === '"""' && !inSingle) {
        inTripleDouble = true
        result += nextThree
        i += 3
        continue
      }
      if (ch === '#') {
        inComment = true
        result += ch
        i += 1
        continue
      }
      if (ch === "'") {
        inSingle = true
        result += ch
        i += 1
        continue
      }
      if (ch === '"') {
        inDouble = true
        result += ch
        i += 1
        continue
      }

      const replacement = FULLWIDTH_PUNCTUATION_MAP[ch]
      if (replacement) {
        result += replacement
        replaced += 1
      } else {
        result += ch
      }

      i += 1
      continue
    }

    if (inTripleSingle) {
      if (nextThree === "'''") {
        inTripleSingle = false
        result += nextThree
        i += 3
      } else {
        result += ch
        i += 1
      }
      continue
    }

    if (inTripleDouble) {
      if (nextThree === '"""') {
        inTripleDouble = false
        result += nextThree
        i += 3
      } else {
        result += ch
        i += 1
      }
      continue
    }

    if (inSingle || inDouble) {
      result += ch
      if (ch === '\\' && i + 1 < code.length) {
        result += code[i + 1]
        i += 2
        continue
      }
      if (inSingle && ch === "'") {
        inSingle = false
      } else if (inDouble && ch === '"') {
        inDouble = false
      }
      i += 1
    }
  }

  return { code: result, replaced }
}

function replaceLineWithDashedLine(code: string): { code: string; changed: number } {
  let result = ''
  let changed = 0
  let i = 0

  while (i < code.length) {
    if (code.startsWith('Line(', i) && !isIdentifierChar(code[i - 1])) {
      let j = i + 5
      let depth = 1
      let inSingle = false
      let inDouble = false
      let inTripleSingle = false
      let inTripleDouble = false

      while (j < code.length && depth > 0) {
        const ch = code[j]
        const nextThree = code.slice(j, j + 3)

        if (!inSingle && !inDouble && !inTripleSingle && !inTripleDouble) {
          if (nextThree === "'''" && !inDouble) {
            inTripleSingle = true
            j += 3
            continue
          }
          if (nextThree === '"""' && !inSingle) {
            inTripleDouble = true
            j += 3
            continue
          }
          if (ch === "'") {
            inSingle = true
            j += 1
            continue
          }
          if (ch === '"') {
            inDouble = true
            j += 1
            continue
          }
          if (ch === '(') {
            depth += 1
          } else if (ch === ')') {
            depth -= 1
          }
          j += 1
          continue
        }

        if (inTripleSingle) {
          if (nextThree === "'''") {
            inTripleSingle = false
            j += 3
          } else {
            j += 1
          }
          continue
        }

        if (inTripleDouble) {
          if (nextThree === '"""') {
            inTripleDouble = false
            j += 3
          } else {
            j += 1
          }
          continue
        }

        if (inSingle || inDouble) {
          if (ch === '\\' && j + 1 < code.length) {
            j += 2
            continue
          }
          if (inSingle && ch === "'") {
            inSingle = false
          } else if (inDouble && ch === '"') {
            inDouble = false
          }
          j += 1
        }
      }

      const segment = code.slice(i, j)
      if (segment.includes('dash_length') || segment.includes('dashed_ratio') || segment.includes('dash_ratio')) {
        result += segment.replace(/^Line\(/, 'DashedLine(')
        changed += 1
      } else {
        result += segment
      }
      i = j
      continue
    }

    result += code[i]
    i += 1
  }

  return { code: result, changed }
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