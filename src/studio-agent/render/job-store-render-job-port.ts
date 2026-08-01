import { getBullJobStatus, getJobResult, getJobStage } from '../../services/job-store'
import type { StudioRenderJobPort } from './render-job-port'

export function createJobStoreRenderJobPort(): StudioRenderJobPort {
  return {
    getStatus: getBullJobStatus,
    getResult: getJobResult,
    getStage: getJobStage
  }
}
