import { createLogger } from '../../utils/logger'
import { createChatCompletionText } from '../openai-stream'
import { createCustomOpenAIClient } from '../openai-client-factory'
import { buildTokenParams } from '../../utils/reasoning-model'
import type { CustomApiConfig } from '../../types'
import type { StaticDiagnostic, StaticGuardContext, StaticGuardResult, StaticPatch, StaticPatchSet } from './types'
import { buildStaticPatchUserPrompt, getStaticPatchSystemPrompt } from './prompt'
import { runStaticChecks } from './checker'

const logger = createLogger('StaticGuardManager')

const STATIC_GUARD_MAX_PASSES = parseInt(process.env.STATIC_GUARD_MAX_PASSES || '3', 10)
const STATIC_GUARD_TEMPERATURE = parseFloat(process.env.STATIC_GUARD_TEMPERATURE || '0.2')
const MAX_TOKENS = parseInt(process.env.AI_MAX_TOKENS || '12000', 10)
const THINKING_TOKENS = parseInt(process.env.AI_THINKING_TOKENS || '20000', 10)

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

function parseSearchReplacePatchResponse(content: string): StaticPatchSet | null {
  const normalized = stripCodeFence(content)
  if (!normalized) {
    return null
  }

  if (/^\s*<!DOCTYPE\s+html/i.test(normalized) || /^\s*<html/i.test(normalized)) {
    throw new Error('Static patch response was HTML, not patch text')
  }

  const patches: StaticPatch[] = []
  let skippedNoopCount = 0
  let blockCount = 0
  let cursor = 0

  const hasPatchMarkers =
    normalized.includes('[[PATCH]]') ||
    normalized.includes('[[SEARCH]]') ||
    normalized.includes('[[REPLACE]]') ||
    normalized.includes('[[END]]')

  while (true) {
    const patchStart = normalized.indexOf('[[PATCH]]', cursor)
    if (patchStart < 0) {
      break
    }

    const searchStart = normalized.indexOf('[[SEARCH]]', patchStart + '[[PATCH]]'.length)
    if (searchStart < 0) {
      throw new Error('Static patch block missing [[SEARCH]] marker')
    }

    const replaceStart = normalized.indexOf('[[REPLACE]]', searchStart + '[[SEARCH]]'.length)
    if (replaceStart < 0) {
      throw new Error('Static patch block missing [[REPLACE]] marker')
    }

    const endStart = normalized.indexOf('[[END]]', replaceStart + '[[REPLACE]]'.length)
    if (endStart < 0) {
      throw new Error('Static patch block missing [[END]] marker')
    }

    blockCount += 1
    const originalSnippet = trimPatchBoundary(
      normalized.slice(searchStart + '[[SEARCH]]'.length, replaceStart)
    )
    const replacementSnippet = trimPatchBoundary(
      normalized.slice(replaceStart + '[[REPLACE]]'.length, endStart)
    )
    if (!originalSnippet.trim()) {
      throw new Error('Static patch block missing SEARCH content')
    }
    if (originalSnippet === replacementSnippet) {
      skippedNoopCount += 1
      cursor = endStart + '[[END]]'.length
      continue
    }
    patches.push({ originalSnippet, replacementSnippet })
    cursor = endStart + '[[END]]'.length
  }

  if (skippedNoopCount > 0) {
    logger.warn('Static patch skipped no-op SEARCH/REPLACE blocks', {
      skippedNoopCount
    })
  }

  if (blockCount > 0) {
    return { patches }
  }

  if (hasPatchMarkers) {
    throw new Error('Static patch markers detected but no complete patch block could be parsed')
  }

  return null
}

function parsePatchResponse(content: string): StaticPatchSet {
  const searchReplacePatchSet = parseSearchReplacePatchResponse(content)
  if (searchReplacePatchSet) {
    logger.info('Static patch raw response extracted', {
      format: 'search-replace',
      contentLength: content.length,
      patchCount: searchReplacePatchSet.patches.length,
      contentPreview: content.trim().slice(0, 500),
      firstSearchPreview: searchReplacePatchSet.patches[0]?.originalSnippet.slice(0, 200) || '',
      firstReplacePreview: searchReplacePatchSet.patches[0]?.replacementSnippet.slice(0, 200) || ''
    })
    return searchReplacePatchSet
  }

  throw new Error('Static patch response did not contain any [[PATCH]] blocks')
}

function getLineNumberAtIndex(text: string, index: number): number {
  return text.slice(0, index).split('\n').length
}

function previewDiagnostics(diagnostics: StaticDiagnostic[], limit = 3): Array<Record<string, unknown>> {
  return diagnostics.slice(0, limit).map((diagnostic) => ({
    tool: diagnostic.tool,
    line: diagnostic.line,
    column: diagnostic.column,
    code: diagnostic.code,
    messagePreview: diagnostic.message.replace(/\s+/g, ' ').trim().slice(0, 180)
  }))
}

function applyPatch(code: string, patch: StaticPatch, targetLine: number): string {
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
    throw new Error('Static patch original_snippet not found in code')
  }

  const bestIndex = matches.reduce((best, current) => {
    const bestDistance = Math.abs(getLineNumberAtIndex(code, best) - targetLine)
    const currentDistance = Math.abs(getLineNumberAtIndex(code, current) - targetLine)
    return currentDistance < bestDistance ? current : best
  })

  return `${code.slice(0, bestIndex)}${patch.replacementSnippet}${code.slice(bestIndex + patch.originalSnippet.length)}`
}

function applyPatchSet(code: string, patchSet: StaticPatchSet, targetLine: number): string {
  if (patchSet.patches.length === 0) {
    return code
  }

  return patchSet.patches.reduce((currentCode, patch, index) => {
    const lineHint = index === 0 ? targetLine : 1
    return applyPatch(currentCode, patch, lineHint)
  }, code)
}

async function generateStaticPatch(
  code: string,
  diagnostics: StaticDiagnostic[],
  customApiConfig: CustomApiConfig
): Promise<StaticPatchSet> {
  const client = createCustomOpenAIClient(customApiConfig)
  const model = (customApiConfig.model || '').trim()
  if (!model) {
    throw new Error('No model available')
  }

  const { content } = await createChatCompletionText(
    client,
    {
      model,
      messages: [
        { role: 'system', content: getStaticPatchSystemPrompt() },
        { role: 'user', content: buildStaticPatchUserPrompt(code, diagnostics) }
      ],
      temperature: STATIC_GUARD_TEMPERATURE,
      ...buildTokenParams(THINKING_TOKENS, MAX_TOKENS)
    },
    { fallbackToNonStream: true, usageLabel: 'static-guard' }
  )

  if (!content) {
    throw new Error('Static patch model returned empty content')
  }

  logger.info('Static patch model response received', {
    diagnosticCount: diagnostics.length,
    diagnosticsPreview: previewDiagnostics(diagnostics),
    contentLength: content.length,
    contentPreview: content.trim().slice(0, 500)
  })

  const patchSet = parsePatchResponse(content)
  logger.info('Static patch parsed', {
    diagnosticCount: diagnostics.length,
    diagnosticsPreview: previewDiagnostics(diagnostics),
    patchCount: patchSet.patches.length,
    patchLengths: patchSet.patches.map((patch) => ({
      originalLength: patch.originalSnippet.length,
      replacementLength: patch.replacementSnippet.length
    })),
    originalPreview: patchSet.patches[0]?.originalSnippet.slice(0, 200) || '',
    replacementPreview: patchSet.patches[0]?.replacementSnippet.slice(0, 200) || ''
  })

  return patchSet
}

export async function runStaticGuardLoop(
  code: string,
  context: StaticGuardContext,
  customApiConfig: CustomApiConfig,
  onCheckpoint?: () => Promise<void>
): Promise<StaticGuardResult> {
  let currentCode = code
  let lastDiagnosticCount = 0

  for (let passIndex = 1; passIndex <= STATIC_GUARD_MAX_PASSES; passIndex++) {
    logger.info('Static guard pass started', {
      passIndex,
      maxPasses: STATIC_GUARD_MAX_PASSES,
      outputMode: context.outputMode,
      codeLength: currentCode.length
    })

    if (onCheckpoint) {
      await onCheckpoint()
    }

    const { diagnostics } = await runStaticChecks(currentCode, context.outputMode)

    if (onCheckpoint) {
      await onCheckpoint()
    }

    if (diagnostics.length === 0) {
      logger.info('Static guard passed', { outputMode: context.outputMode, passes: passIndex - 1 })
      return {
        code: currentCode,
        passes: passIndex - 1
      }
    }

    logger.warn('Static guard found diagnostics', {
      passIndex,
      diagnosticCount: diagnostics.length,
      diagnosticsPreview: previewDiagnostics(diagnostics)
    })
    lastDiagnosticCount = diagnostics.length

    if (onCheckpoint) {
      await onCheckpoint()
    }

    const patchSet = await generateStaticPatch(currentCode, diagnostics, customApiConfig)
    if (patchSet.patches.length === 0) {
      logger.warn('Static patch produced no effective changes, stopping static patching for this pass', {
        passIndex,
        diagnosticCount: diagnostics.length,
        diagnosticsPreview: previewDiagnostics(diagnostics)
      })
      break
    }
    currentCode = applyPatchSet(currentCode, patchSet, diagnostics[0]?.line || 1)

    if (onCheckpoint) {
      await onCheckpoint()
    }

    logger.info('Static guard patch applied', {
      passIndex,
      diagnosticCount: diagnostics.length,
      diagnosticsPreview: previewDiagnostics(diagnostics),
      patchCount: patchSet.patches.length,
      patchLengths: patchSet.patches.map((patch) => ({
        originalLength: patch.originalSnippet.length,
        replacementLength: patch.replacementSnippet.length
      }))
    })
  }

  logger.warn('Static guard max passes reached, skipping remaining diagnostics and continuing', {
    maxPasses: STATIC_GUARD_MAX_PASSES,
    remainingDiagnosticCount: lastDiagnosticCount
  })
  return {
    code: currentCode,
    passes: STATIC_GUARD_MAX_PASSES
  }
}
