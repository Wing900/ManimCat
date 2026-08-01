import type { JobResult, ProcessingStage } from '../../types'

export type StudioRenderQueueStatus = 'waiting' | 'active' | 'completed' | 'failed' | 'delayed'

export interface StudioRenderJobPort {
  getStatus: (jobId: string) => Promise<StudioRenderQueueStatus | null>
  getResult: (jobId: string) => Promise<JobResult | null>
  getStage: (jobId: string) => Promise<ProcessingStage | null>
}

export function createEmptyStudioRenderJobPort(): StudioRenderJobPort {
  return {
    async getStatus() {
      return null
    },
    async getResult() {
      return null
    },
    async getStage() {
      return null
    }
  }
}
