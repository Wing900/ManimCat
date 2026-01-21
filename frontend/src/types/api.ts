// API 类型定义

/** 视频质量选项 */
export type Quality = 'low' | 'medium' | 'high';

/** 任务状态 */
export type JobStatus = 'processing' | 'completed' | 'failed';

/** 处理阶段 */
export type ProcessingStage = 'analyzing' | 'generating' | 'refining' | 'rendering' | 'still-rendering';

/** 生成请求 */
export interface GenerateRequest {
  concept: string;
  quality?: Quality;
  forceRefresh?: boolean;
  /** 预生成的代码（使用自定义 AI 时） */
  code?: string;
}

/** 生成响应 */
export interface GenerateResponse {
  success: boolean;
  jobId: string;
  message: string;
  status: JobStatus;
}

/** 任务结果 */
export interface JobResult {
  jobId: string;
  status: JobStatus;
  stage?: ProcessingStage;
  message?: string;
  success?: boolean;
  video_url?: string;
  code?: string;
  used_ai?: boolean;
  render_quality?: string;
  generation_type?: string;
  error?: string;
  details?: string;
}

/** API 错误 */
export interface ApiError {
  error: string;
}
