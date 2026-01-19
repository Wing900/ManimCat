// API 请求函数

import type { GenerateRequest, GenerateResponse, JobResult, ApiError } from '../types/api';

const API_BASE = '/api';

/**
 * 提交动画生成请求
 */
export async function generateAnimation(request: GenerateRequest, signal?: AbortSignal): Promise<GenerateResponse> {
  const response = await fetch(`${API_BASE}/generate`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(request),
    signal,
  });

  if (!response.ok) {
    const error: ApiError = await response.json();
    throw new Error(error.error || '生成请求失败');
  }

  return response.json();
}

/**
 * 查询任务状态
 */
export async function getJobStatus(jobId: string, signal?: AbortSignal): Promise<JobResult> {
  const response = await fetch(`${API_BASE}/jobs/${jobId}`, { signal });

  if (!response.ok) {
    const error: ApiError = await response.json();
    throw new Error(error.error || '查询任务状态失败');
  }

  return response.json();
}
