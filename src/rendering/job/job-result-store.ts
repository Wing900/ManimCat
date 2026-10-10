/**
 * Job Result Store port
 */

import type { JobResult } from './job-types'
import type { StoreJobResultOutcome } from './job-types'

export interface JobResultStore {
  store(jobId: string, result: JobResult): Promise<StoreJobResultOutcome>
  read(jobId: string): Promise<JobResult | null>
  delete(jobId: string): Promise<void>
  readAll(): Promise<Array<{ jobId: string; result: JobResult }>>
}
