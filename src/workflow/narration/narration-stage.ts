/**
 * Narration stage: one independent model turn over an already-fixed storyboard.
 *
 * It receives the cue plan produced by the design stage and returns speakable text
 * with exactly those cue markers. It does not expand the mathematical topic and it
 * never talks to TTS; audio timing belongs to prepareNarration / the GX runtime.
 */

import OpenAI from 'openai'
import { createLogger } from '../../shared/logging/logger'
import { getNarrationPrompt, type PromptLocale, type PromptOverrides } from '../../prompts'
import { buildCompletionParams, readMaxCompletionTokens } from '../../infrastructure/ai-provider/completion-policy'
import { createChatCompletionText } from '../openai-stream'
import { buildNarrationInput } from './narration-input'
import type { CuePlan, NarrationConfig, NarrationPlan, NarrationPlanSegment } from './types'

const logger = createLogger('NarrationStage')

const NARRATION_TEMPERATURE = parseFloat(process.env.NARRATION_TEMPERATURE || '0.6')
const NARRATION_MAX_TOKENS = readMaxCompletionTokens('NARRATION')
const MAX_ATTEMPTS = 2
const MARKER_PATTERN = /\[\[([^\[\]]+)\]\]/g

export interface NarrationStageParams {
  client: OpenAI
  model: string
  cuePlan: CuePlan
  config: NarrationConfig
  onCheckpoint?: () => Promise<void>
  /**
   * Optional locale override. By default the narration language follows the selected
   * Edge voice (zh-* -> Chinese, en-* -> English), matching the on-screen language.
   */
  locale?: PromptLocale
  promptOverrides?: PromptOverrides
}

export class NarrationPlanError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'NarrationPlanError'
  }
}

function resolveLocale(config: NarrationConfig, explicit?: PromptLocale): PromptLocale {
  if (explicit) return explicit
  return /^en[-_]/i.test(config.voice) ? 'en-US' : 'zh-CN'
}

/** Extract the JSON body from an otherwise plain model answer. */
export function extractNarrationJson(content: string): string {
  const sanitized = content.replace(/<think[\s\S]*?<\/think>/gi, '').trim()
  const fenced = sanitized.match(/```(?:json)?\s*([\s\S]*?)\s*```/i)
  const body = fenced ? fenced[1].trim() : sanitized
  if (body.startsWith('{') && body.endsWith('}')) return body
  const start = body.indexOf('{')
  const end = body.lastIndexOf('}')
  if (start >= 0 && end > start) return body.slice(start, end + 1)
  return body
}

function markerIds(text: string): string[] {
  return Array.from(text.matchAll(MARKER_PATTERN), (match) => match[1])
}

/**
 * Enforce the marker contract: every plan segment appears once and in plan order;
 * every cue appears exactly once in its own segment, in plan order. No cue is moved,
 * merged or invented.
 */
export function validateNarrationPlan(raw: unknown, cuePlan: CuePlan): NarrationPlan {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new NarrationPlanError('Narration response must be a JSON object')
  }
  const segmentsValue = (raw as { segments?: unknown }).segments
  if (!Array.isArray(segmentsValue) || segmentsValue.length === 0) {
    throw new NarrationPlanError('Narration response needs a non-empty segments array')
  }

  const byId = new Map<string, NarrationPlanSegment>()
  for (let index = 0; index < segmentsValue.length; index += 1) {
    const rawSegment = segmentsValue[index]
    if (!rawSegment || typeof rawSegment !== 'object' || Array.isArray(rawSegment)) {
      throw new NarrationPlanError(`segments[${index}] must be an object`)
    }
    const { id, text } = rawSegment as { id?: unknown; text?: unknown }
    if (typeof id !== 'string' || !id.trim()) {
      throw new NarrationPlanError(`segments[${index}].id must be a non-empty string`)
    }
    if (typeof text !== 'string') {
      throw new NarrationPlanError(`segments[${index}].text must be a string`)
    }
    const normalizedId = id.trim()
    if (byId.has(normalizedId)) {
      throw new NarrationPlanError(`duplicate narration segment ${JSON.stringify(normalizedId)}`)
    }
    byId.set(normalizedId, { id: normalizedId, text: text.trim() })
  }

  const plannedIds = cuePlan.segments.map((segment) => segment.id)
  for (const plannedId of plannedIds) {
    if (!byId.has(plannedId)) {
      throw new NarrationPlanError(`narration is missing cue-plan segment ${JSON.stringify(plannedId)}`)
    }
  }
  for (const actualId of byId.keys()) {
    if (!plannedIds.includes(actualId)) {
      throw new NarrationPlanError(`narration contains unknown segment ${JSON.stringify(actualId)}`)
    }
  }

  for (const plannedSegment of cuePlan.segments) {
    const narration = byId.get(plannedSegment.id)!
    const cueIds = plannedSegment.cues.map((cue) => cue.id)
    // A wordless shot is allowed, but only when the shot itself has nothing to point
    // at. Silence cannot anchor a cue to a spoken word, so the cue plan must agree.
    if (!narration.text && cueIds.length > 0) {
      throw new NarrationPlanError(
        `segment ${JSON.stringify(plannedSegment.id)} is wordless but carries ${cueIds.length} cue(s); leave its text empty only when the cue plan has no cues for that shot`
      )
    }
    const order = new Map(cueIds.map((cueId, index) => [cueId, index]))
    const found = markerIds(narration.text)
    const counts = new Map<string, number>()

    for (const marker of found) {
      if (!order.has(marker)) {
        throw new NarrationPlanError(
          `segment ${JSON.stringify(plannedSegment.id)} contains unknown cue marker [[${marker}]]`
        )
      }
      counts.set(marker, (counts.get(marker) ?? 0) + 1)
    }
    for (const cueId of cueIds) {
      const count = counts.get(cueId) ?? 0
      if (count === 0) {
        throw new NarrationPlanError(
          `segment ${JSON.stringify(plannedSegment.id)} is missing marker [[${cueId}]]`
        )
      }
      if (count > 1) {
        throw new NarrationPlanError(
          `segment ${JSON.stringify(plannedSegment.id)} repeats marker [[${cueId}]] ${count} times`
        )
      }
    }

    let previous = -1
    for (const marker of found) {
      const current = order.get(marker)!
      if (current <= previous) {
        throw new NarrationPlanError(
          `segment ${JSON.stringify(plannedSegment.id)} places cue markers out of plan order`
        )
      }
      previous = current
    }
  }

  const openingSegment = cuePlan.segments.find((segment) => segment.cues.length > 0)
  if (openingSegment) {
    const firstCue = openingSegment.cues[0].id
    const openingText = byId.get(openingSegment.id)!.text
    if (!openingText.startsWith(`[[${firstCue}]]`)) {
      throw new NarrationPlanError(
        `opening segment ${JSON.stringify(openingSegment.id)} must begin with [[${firstCue}]] before any spoken text, so the opening visual starts with the explanation`
      )
    }
  }

  return {
    segments: plannedIds.map((id) => ({ id, text: byId.get(id)!.text }))
  }
}

function repairInstruction(error: string, locale: PromptLocale): string {
  if (locale === 'en-US') {
    return `Your previous answer violated the narration contract: ${error}\nRewrite the complete JSON. Include every cue-plan segment once, in plan order. A shot with no cues may use an empty text; every other shot must place each [[cue_id]] exactly once, in plan order. Output JSON only.`
  }
  return `你上一条输出违反了旁白契约：${error}\n请重写完整 JSON。每个 cue 计划 segment 必须出现一次且顺序一致；没有 cue 的镜头可以把 text 写成空字符串；其余镜头里每个 [[cue_id]] 必须在其所属 segment 内恰好出现一次，顺序与计划一致。只输出 JSON。`
}

/**
 * Generate one NarrationPlan for the fixed storyboard.
 *
 * Uses the same upstream client and createChatCompletionText path as the other AI
 * stages. One optional repair turn exists to fix a malformed marker/JSON answer; it
 * is still a plain request/response call, not an agent.
 */
export async function generateNarrationStage(
  params: NarrationStageParams
): Promise<NarrationPlan> {
  const { client, model, cuePlan, config, onCheckpoint } = params
  const locale = resolveLocale(config, params.locale ?? params.promptOverrides?.locale)
  const prompt = getNarrationPrompt(locale, {
    narrationInput: JSON.stringify(buildNarrationInput(cuePlan), null, 2)
  }, params.promptOverrides)

  const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
    { role: 'system', content: prompt.system },
    { role: 'user', content: prompt.user }
  ]

  logger.info('开始旁白生成', {
    model,
    locale,
    voice: config.voice,
    rate: config.rate,
    segments: cuePlan.segments.length,
    cues: cuePlan.segments.reduce((total, segment) => total + segment.cues.length, 0)
  })

  let lastError: NarrationPlanError | undefined
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    if (onCheckpoint) await onCheckpoint()
    const completion = await createChatCompletionText(
      client,
      {
        model,
        messages,
        temperature: NARRATION_TEMPERATURE,
        ...buildCompletionParams(NARRATION_MAX_TOKENS, 'NARRATION', client)
      },
      {
        fallbackToNonStream: true,
        usageLabel: attempt === 1 ? 'narration-plan' : 'narration-plan-repair'
      }
    )
    if (onCheckpoint) await onCheckpoint()

    const content = typeof completion.content === 'string' ? completion.content.trim() : ''
    if (!content) {
      throw new NarrationPlanError('Narration stage returned empty content')
    }

    try {
      const parsed = JSON.parse(extractNarrationJson(content)) as unknown
      const plan = validateNarrationPlan(parsed, cuePlan)
      logger.info('旁白生成成功', {
        mode: completion.mode,
        attempt,
        segments: plan.segments.length
      })
      return plan
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error)
      lastError = error instanceof NarrationPlanError
        ? error
        : new NarrationPlanError(`Narration response is invalid: ${reason}`)
      logger.warn('旁白输出未通过契约检查', { attempt, reason })
      if (attempt >= MAX_ATTEMPTS) break
      messages.push({ role: 'assistant', content })
      messages.push({ role: 'user', content: repairInstruction(reason, locale) })
    }
  }

  throw lastError ?? new NarrationPlanError('Narration stage failed without a result')
}
