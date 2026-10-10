import fs from 'fs'
import os from 'os'
import path from 'path'
import { spawn } from 'child_process'
import { createLogger } from '../../utils/logger'
import type { OutputMode } from '../../types'
import type { StaticCheckBatch, StaticDiagnostic } from './types'

const logger = createLogger('StaticGuardChecker')

interface CommandResult {
  exitCode: number | null
  stdout: string
  stderr: string
}

interface CodeUnit {
  code: string
  lineOffset: number
}

function runCommand(command: string, args: string[], cwd: string): Promise<CommandResult> {
  return new Promise((resolve, reject) => {
    logger.info('Running static guard command', {
      command,
      args,
      cwd
    })
    const proc = spawn(command, args, { cwd, windowsHide: true })
    let stdout = ''
    let stderr = ''

    proc.stdout.on('data', (chunk) => {
      stdout += chunk.toString()
    })

    proc.stderr.on('data', (chunk) => {
      stderr += chunk.toString()
    })

    proc.on('error', (error) => {
      const suffix = args.length > 0 ? ` ${args.join(' ')}` : ''
      reject(new Error(`Failed to spawn command: ${command}${suffix} (${String(error)})`))
    })
    proc.on('close', (exitCode) => {
      logger.info('Static guard command finished', {
        command,
        args,
        cwd,
        exitCode,
        stdoutPreview: stdout.trim().slice(0, 300),
        stderrPreview: stderr.trim().slice(0, 300)
      })
      resolve({ exitCode, stdout, stderr })
    })
  })
}

/**
 * Pure image-block extraction for `image` output mode. Each unit carries the line
 * offset that maps its unit-relative diagnostics back onto the original document:
 * `lineOffset` is the number of `\n` characters before the first character of
 * `unit.code`, so `documentLine = unitLine + lineOffset` holds for LF and CRLF
 * documents alike. Exported for unit-level specification; the subprocess engine
 * stays private.
 */
export function parseImageCodeUnits(code: string): CodeUnit[] {
  const units: CodeUnit[] = []
  const blockRegex = /(###\s*YON_IMAGE_(\d+)_START\s*###)([\s\S]*?)###\s*YON_IMAGE_\2_END\s*###/g

  let match: RegExpExecArray | null
  while ((match = blockRegex.exec(code)) !== null) {
    const rawCode = match[3]
    const blockCode = rawCode.trim()
    if (!blockCode) {
      continue
    }

    // The marker capture ends exactly where the raw block starts; trimming may then skip
    // leading newlines, indentation or both, and every skipped newline is a document line.
    const rawStart = match.index + match[1].length
    const leadingWhitespace = rawCode.length - rawCode.trimStart().length
    const codeStart = rawStart + leadingWhitespace
    units.push({ code: blockCode, lineOffset: countDocumentLinesBefore(code, codeStart) })
  }

  if (units.length === 0) {
    units.push({ code, lineOffset: 0 })
  }

  return units
}

/** The document line of `index` is `countDocumentLinesBefore(source, index) + 1`. */
function countDocumentLinesBefore(source: string, index: number): number {
  let newlines = 0
  for (let position = 0; position < index; position += 1) {
    if (source.charCodeAt(position) === 10) {
      newlines += 1
    }
  }
  return newlines
}

function getCodeUnits(code: string, outputMode: OutputMode): CodeUnit[] {
  if (outputMode === 'image') {
    return parseImageCodeUnits(code)
  }
  return [{ code, lineOffset: 0 }]
}

function parsePyCompileDiagnostic(stderr: string, lineOffset: number): StaticDiagnostic | null {
  const normalized = stderr.replace(/\r\n/g, '\n').trim()
  if (!normalized) {
    return null
  }

  const lineMatch = normalized.match(/line\s+(\d+)/i)
  const line = lineMatch ? Number.parseInt(lineMatch[1], 10) + lineOffset : 1 + lineOffset
  const lines = normalized.split('\n').map((item) => item.trim()).filter(Boolean)
  const message = lines[lines.length - 1] || normalized

  return {
    tool: 'py_compile',
    line,
    message
  }
}

async function checkCodeUnit(code: string, lineOffset: number): Promise<StaticDiagnostic[]> {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'manim-static-'))
  const codeFile = path.join(tempDir, 'scene.py')

  try {
    fs.writeFileSync(codeFile, code, 'utf-8')
    logger.info('Static guard checking code unit', {
      tempDir,
      codeFile,
      lineOffset,
      codeLength: code.length
    })

    const pyCompileResult = await runCommand('python', ['-m', 'py_compile', codeFile], tempDir)
    if (pyCompileResult.exitCode !== 0) {
      logger.warn('py_compile reported diagnostic', {
        codeFile,
        lineOffset,
        stderrPreview: pyCompileResult.stderr.trim().slice(0, 300)
      })
      const diagnostic = parsePyCompileDiagnostic(pyCompileResult.stderr, lineOffset)
      return diagnostic ? [diagnostic] : []
    }

    return []
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true })
  }
}

export interface PythonStaticCheckOptions {
  /** Added to every reported line so unit-relative lines map onto the document. */
  lineOffset?: number
}

function compareDiagnostics(left: StaticDiagnostic, right: StaticDiagnostic): number {
  return left.line - right.line || (left.column || 0) - (right.column || 0)
}

/**
 * Package-neutral whole-file Python check: one temporary file, `python -m py_compile`,
 * parsed diagnostics, deterministic ordering, cleanup in `finally`. This is the single
 * subprocess entry point for both Studio Adapters and the classic workflow; a unit with
 * valid syntax reports nothing.
 */
export async function runPythonStaticChecks(
  code: string,
  options?: PythonStaticCheckOptions
): Promise<StaticCheckBatch> {
  const lineOffset = options?.lineOffset ?? 0
  const diagnostics = await checkCodeUnit(code, lineOffset)
  diagnostics.sort(compareDiagnostics)
  return { diagnostics }
}

/**
 * Classic entry point, unchanged for the generation workflow: `image` mode splits
 * YON_IMAGE_n blocks and keeps each block's line offset, `video` mode checks the whole source.
 */
export async function runStaticChecks(code: string, outputMode: OutputMode): Promise<StaticCheckBatch> {
  const units = getCodeUnits(code, outputMode)
  const diagnostics: StaticDiagnostic[] = []
  for (const unit of units) {
    const batch = await runPythonStaticChecks(unit.code, {
      lineOffset: unit.lineOffset
    })
    diagnostics.push(...batch.diagnostics)
  }
  diagnostics.sort(compareDiagnostics)
  return { diagnostics }
}
