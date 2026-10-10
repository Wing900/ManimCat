import type { OutputMode } from '../../types'

export interface RenderFailureEventRow {
  id: string
  created_at: string
  job_id: string
  attempt: number
  output_mode: OutputMode
  error_type: string
  error_message: string
  stderr_preview: string
  stdout_preview?: string | null
  code_snippet?: string | null
  full_code?: string | null
  peak_memory_mb?: number | null
  exit_code?: number | null
  recovered?: boolean | null
  model?: string | null
  prompt_version?: string | null
  prompt_role?: string | null
  client_id?: string | null
  concept?: string | null
}

export interface CreateRenderFailureEventInput {
  job_id: string
  attempt: number
  output_mode: OutputMode
  error_type: string
  error_message: string
  stderr_preview: string
  stdout_preview?: string | null
  code_snippet?: string | null
  full_code?: string | null
  peak_memory_mb?: number | null
  exit_code?: number | null
  recovered?: boolean | null
  model?: string | null
  prompt_version?: string | null
  prompt_role?: string | null
  client_id?: string | null
  concept?: string | null
}

export interface RenderFailureQuery {
  from?: string
  to?: string
  errorType?: string
  outputMode?: OutputMode
  jobId?: string
  recovered?: boolean
  page?: number
  pageSize?: number
  limit?: number
}

export interface RenderFailureListResult {
  records: RenderFailureEventRow[]
  total: number
  page: number
  pageSize: number
  hasMore: boolean
}

