import { extractErrorMessage, getErrorType } from '../../workflow/code-retry/utils'

const STDERR_LIMIT = 4 * 1024
const STDOUT_LIMIT = 2 * 1024
const FULL_CODE_LIMIT = 32 * 1024
const CODE_SNIPPET_LIMIT = 2 * 1024
const CODE_SNIPPET_LINES = 120

export function truncateText(input: string | undefined | null, maxLength: number): string {
  if (!input) {
    return ''
  }

  if (input.length <= maxLength) {
    return input
  }

  return `${input.slice(0, maxLength)}\n...[truncated]`
}

export function sanitizeStderrPreview(stderr: string | undefined | null): string {
  return truncateText(stderr, STDERR_LIMIT)
}

export function sanitizeStdoutPreview(stdout: string | undefined | null): string {
  return truncateText(stdout, STDOUT_LIMIT)
}

export function sanitizeFullCode(code: string | undefined | null): string {
  return truncateText(code, FULL_CODE_LIMIT)
}

export function extractCodeSnippet(code: string | undefined | null): string {
  if (!code) {
    return ''
  }

  const lines = code.split(/\r?\n/)
  const head = lines.slice(0, CODE_SNIPPET_LINES).join('\n')
  return truncateText(head, CODE_SNIPPET_LIMIT)
}

export function inferErrorType(stderr: string | undefined | null): string {
  return getErrorType(stderr || '')
}

export function inferErrorMessage(stderr: string | undefined | null): string {
  return extractErrorMessage(stderr || '')
}