import { v4 as uuidv4 } from 'uuid'
import type { OutputMode, VideoQuality } from '../../types'

export interface ManimRenderSubmissionInput {
  jobId: string
  concept: string
  code: string
  outputMode: OutputMode
  quality: VideoQuality
  workspaceDirectory: string
  signal?: AbortSignal
}

export interface ManimRenderPort {
  submit: (input: ManimRenderSubmissionInput) => Promise<{ jobId: string }>
  /** Cancel a persisted queue job; terminal jobs retain their actual outcome. */
  cancel?: (jobId: string) => Promise<'cancelled' | 'completed' | 'failed'>
}

export function createManimRenderJobId(): string {
  return uuidv4()
}
