import { v4 as uuidv4 } from 'uuid'
import type { OutputMode, VideoQuality } from '../../types'

export interface ManimRenderSubmissionInput {
  jobId: string
  concept: string
  code: string
  outputMode: OutputMode
  quality: VideoQuality
  workspaceDirectory: string
}

export interface ManimRenderPort {
  submit: (input: ManimRenderSubmissionInput) => Promise<{ jobId: string }>
}

export function createUnconfiguredManimRenderPort(): ManimRenderPort {
  return {
    async submit() {
      throw new Error('Manim render port is not configured')
    }
  }
}

export function createManimRenderJobId(): string {
  return uuidv4()
}
