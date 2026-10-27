/**
 * Cue plan parsing for narration-enabled storyboards.
 *
 * The storyboard keeps its original four sections. Narration-enabled designs add one
 * extra block inside <design>:
 *
 *   <cue_plan>{"segments":[...]}</cue_plan>
 *
 * This module is deliberately narrow: extract the block, JSON.parse it, and enforce
 * the ID/field contract the runtime depends on. It never invents cues or reorders
 * them silently.
 */

import type { CuePlan, CuePlanCue, CuePlanSegment } from './types'

const CUE_PLAN_BLOCK = /<cue_plan>([\s\S]*?)<\/cue_plan>/gi
const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/
const MAX_SEGMENTS = 64
const MAX_CUES_PER_SEGMENT = 64
const MAX_TEXT_LENGTH = 2000

export class NarrationCuePlanError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'NarrationCuePlanError'
  }
}

function describePreview(value: string): string {
  const compact = value.replace(/\s+/g, ' ').trim()
  return compact.length > 200 ? `${compact.slice(0, 200)}…` : compact
}

function stripJsonFence(value: string): string {
  const trimmed = value.trim()
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i)
  return fenced ? fenced[1].trim() : trimmed
}

function requireText(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new NarrationCuePlanError(`${label} must be a non-empty string`)
  }
  const text = value.trim()
  if (text.length > MAX_TEXT_LENGTH) {
    throw new NarrationCuePlanError(`${label} is longer than ${MAX_TEXT_LENGTH} characters`)
  }
  return text
}

function requireId(value: unknown, label: string, seen: Set<string>): string {
  if (typeof value !== 'string' || !ID_PATTERN.test(value.trim())) {
    throw new NarrationCuePlanError(
      `${label} must match [A-Za-z0-9][A-Za-z0-9_-]* (max 64 chars), got ${JSON.stringify(value)}`
    )
  }
  const id = value.trim()
  if (seen.has(id)) {
    throw new NarrationCuePlanError(`${label} duplicates id ${JSON.stringify(id)}`)
  }
  seen.add(id)
  return id
}

function validateCuePlan(raw: unknown): CuePlan {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new NarrationCuePlanError('cue_plan must be a JSON object')
  }
  const segmentsValue = (raw as { segments?: unknown }).segments
  if (!Array.isArray(segmentsValue) || segmentsValue.length === 0) {
    throw new NarrationCuePlanError('cue_plan.segments must be a non-empty array')
  }
  if (segmentsValue.length > MAX_SEGMENTS) {
    throw new NarrationCuePlanError(`cue_plan has more than ${MAX_SEGMENTS} segments`)
  }

  const segmentIds = new Set<string>()
  const cueIds = new Set<string>()
  const segments: CuePlanSegment[] = segmentsValue.map((rawSegment, segmentIndex) => {
    if (!rawSegment || typeof rawSegment !== 'object' || Array.isArray(rawSegment)) {
      throw new NarrationCuePlanError(`cue_plan.segments[${segmentIndex}] must be an object`)
    }
    const segment = rawSegment as { id?: unknown; visuals?: unknown; cues?: unknown }
    const id = requireId(segment.id, `cue_plan.segments[${segmentIndex}].id`, segmentIds)
    const visuals = requireText(segment.visuals, `cue_plan.segments[${segmentIndex}].visuals`)
    if (!Array.isArray(segment.cues) || segment.cues.length === 0) {
      throw new NarrationCuePlanError(`cue_plan.segments[${segmentIndex}].cues must be a non-empty array`)
    }
    if (segment.cues.length > MAX_CUES_PER_SEGMENT) {
      throw new NarrationCuePlanError(
        `cue_plan.segments[${segmentIndex}] has more than ${MAX_CUES_PER_SEGMENT} cues`
      )
    }
    const cues: CuePlanCue[] = segment.cues.map((rawCue, cueIndex) => {
      if (!rawCue || typeof rawCue !== 'object' || Array.isArray(rawCue)) {
        throw new NarrationCuePlanError(
          `cue_plan.segments[${segmentIndex}].cues[${cueIndex}] must be an object`
        )
      }
      const cue = rawCue as { id?: unknown; action?: unknown }
      return {
        id: requireId(
          cue.id,
          `cue_plan.segments[${segmentIndex}].cues[${cueIndex}].id`,
          cueIds
        ),
        action: requireText(
          cue.action,
          `cue_plan.segments[${segmentIndex}].cues[${cueIndex}].action`
        )
      }
    })
    return { id, visuals, cues }
  })

  return { segments }
}

/** All cue IDs in plan order (segments in order, cues in order). */
export function flattenCueIds(plan: CuePlan): string[] {
  return plan.segments.flatMap((segment) => segment.cues.map((cue) => cue.id))
}

/**
 * Remove the narration block from a storyboard so the coder reads only the original
 * four sections. Returns the original string untouched when no block exists.
 */
export function stripCuePlan(sceneDesign: string): string {
  if (!sceneDesign || !/<cue_plan>/i.test(sceneDesign)) {
    return sceneDesign
  }
  return sceneDesign
    .replace(CUE_PLAN_BLOCK, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/**
 * Parse and validate the <cue_plan> JSON embedded in a storyboard.
 * Throws NarrationCuePlanError with a concrete reason instead of returning a
 * partial plan.
 */
export function parseCuePlan(sceneDesign: string): CuePlan {
  if (typeof sceneDesign !== 'string' || !sceneDesign.trim()) {
    throw new NarrationCuePlanError('Storyboard is empty; cannot read cue_plan')
  }

  const blocks = Array.from(sceneDesign.matchAll(CUE_PLAN_BLOCK))
  if (blocks.length === 0) {
    throw new NarrationCuePlanError('Storyboard has no <cue_plan>...</cue_plan> block')
  }
  if (blocks.length > 1) {
    throw new NarrationCuePlanError(
      `Storyboard has ${blocks.length} <cue_plan> blocks; exactly one is required`
    )
  }

  const source = stripJsonFence(blocks[0][1])
  if (!source) {
    throw new NarrationCuePlanError('<cue_plan> block is empty')
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(source)
  } catch (error) {
    throw new NarrationCuePlanError(
      `cue_plan is not valid JSON (${error instanceof Error ? error.message : String(error)}): ${describePreview(source)}`
    )
  }

  return validateCuePlan(parsed)
}
