/**
 * Job State Store port
 */

import type { ProcessingStage } from './job-types'

export interface JobStateStore {
  writeStage(jobId: string, stage: ProcessingStage): Promise<void>
  readStage(jobId: string): Promise<ProcessingStage | null>
  deleteStage(jobId: string): Promise<void>
}
