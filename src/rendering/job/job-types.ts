/**
 * Job domain types
 */

import type { JobResult, ProcessingStage } from '../../types'

export type StoreJobResultOutcome = 'stored' | 'preserved-completed' | 'preserved-failed'

export interface JobTrackingState {
  revision: number
  updatedAt: string
  submittedAt: string | null
  attempt: number
  status: 'queued' | 'processing' | 'completed' | 'failed'
  stage: ProcessingStage | null
  stageStartedAt: string | null
}

export interface StoreJobStageOptions {
  status?: JobTrackingState['status']
  attempt?: number
  submittedAt?: string
}

export type { JobResult, ProcessingStage }
