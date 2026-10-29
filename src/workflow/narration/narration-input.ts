import type { CuePlan, CuePlanCue, SegmentTeachingPlan } from './types'

export interface NarrationInput {
  segments: Array<{
    id: string
    teaching?: SegmentTeachingPlan
    /** Legacy plans fall back to their original shot description. */
    visuals?: string
    cues: Array<Pick<CuePlanCue, 'id' | 'meaning'>>
  }>
}

/** Project only teaching content into the narrator's context. Keep production data with the coder. */
export function buildNarrationInput(plan: CuePlan): NarrationInput {
  return {
    segments: plan.segments.map((segment) => ({
      id: segment.id,
      ...(segment.teaching ? {
        teaching: {
          learningGoal: segment.teaching.learningGoal,
          narrationDraft: segment.teaching.narrationDraft,
          visualEvidence: segment.teaching.visualEvidence,
        },
      } : { visuals: segment.visuals }),
      cues: segment.cues.map((cue) => ({
        id: cue.id,
        ...(cue.meaning !== undefined ? { meaning: cue.meaning } : {}),
      })),
    })),
  }
}
