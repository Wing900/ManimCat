/**
 * Narration contract shared by the workflow, the TTS stage and the ManimGX runtime.
 *
 * The backend owns every path in these structures. Requests from the browser may
 * carry only the three user-facing settings (enabled / voice / rate), never a file
 * path or a pre-computed timestamp.
 */

/** User-facing narration settings stored in VideoConfig.narration. */
export interface NarrationConfig {
  enabled: boolean
  voice: string
  rate: string
}

export interface CuePlanCue {
  id: string
  /** Concrete on-screen action or state at this cue. No durations. */
  action: string
}

export interface CuePlanSegment {
  id: string
  /** What this shot shows, in one sentence. */
  visuals: string
  cues: CuePlanCue[]
}

/**
 * Storyboard timing skeleton produced together with the fixed four-section design.
 * IDs are the only contract between code generation, narration and the runtime.
 */
export interface CuePlan {
  segments: CuePlanSegment[]
}

export interface NarrationPlanSegment {
  id: string
  /** Spoken text; contains [[cue_id]] markers for this segment's cues. */
  text: string
}

/** One independent model turn over the already-fixed storyboard. */
export interface NarrationPlan {
  segments: NarrationPlanSegment[]
}

export interface NarrationManifestSegment {
  id: string
  /** Seconds from the start of the complete audio track. */
  start: number
  duration: number
  /** Backend-generated path to this segment's audio file. */
  audioPath: string
  /** Cue times in seconds relative to this segment's start. */
  cues: Record<string, number>
}

/**
 * Timing truth for the renderer. Top-level cues are absolute seconds in the final
 * audio track; segment cues are segment-relative and exist for cross-checking.
 */
export interface NarrationManifest {
  version: 1
  /** Backend-generated path to the complete audio track. */
  audioPath: string
  duration: number
  segments: NarrationManifestSegment[]
  cues: Record<string, number>
}

/** Backend result handed back to orchestration/render; paths are server-generated. */
export interface NarrationAssets {
  manifestPath: string
  audioPath: string
  duration: number
}

export const DEFAULT_NARRATION_CONFIG: Readonly<NarrationConfig> = Object.freeze({
  enabled: false,
  voice: 'zh-CN-XiaoxiaoNeural',
  rate: '+0%'
})

/**
 * Normalize an optional/partial narration setting into the full contract shape.
 * Missing fields keep the documented defaults; narration stays off unless enabled
 * is literally true.
 */
export function resolveNarrationConfig(
  config?: Partial<NarrationConfig> | null
): NarrationConfig {
  const voice = typeof config?.voice === 'string' ? config.voice.trim() : ''
  const rate = typeof config?.rate === 'string' ? config.rate.trim() : ''
  return {
    enabled: config?.enabled === true,
    voice: voice || DEFAULT_NARRATION_CONFIG.voice,
    rate: rate || DEFAULT_NARRATION_CONFIG.rate
  }
}

/** True only when the job explicitly opted in. */
export function isNarrationEnabled(
  config?: Partial<NarrationConfig> | null
): boolean {
  return config?.enabled === true
}
