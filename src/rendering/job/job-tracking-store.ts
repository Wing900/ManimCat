/**
 * Job Tracking Store port
 */

import type { JobTrackingState, StoreJobStageOptions } from './job-types'

export interface JobTrackingStore {
  write(jobId: string, options: StoreJobStageOptions): Promise<void>
  touch(jobId: string, attempt?: number): Promise<boolean>
  read(jobId: string): Promise<JobTrackingState | null>
  delete(jobId: string): Promise<void>
}
