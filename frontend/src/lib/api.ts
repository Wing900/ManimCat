// API 请求函数

import type { GenerateRequest, GenerateResponse, JobResult, ApiError, VideoConfig } from '../types/api';

const API_BASE = '/api';

/** 从 localStorage 加载视频配置 */
function loadVideoConfig(): VideoConfig {
  try {
    const saved = localStorage.getItem('manimcat_settings');
    if (saved) {
      const parsed = JSON.parse(saved);
      if (parsed.video) {
        return parsed.video;
      }
    }
  } catch {
    // 忽略错误，使用默认值
  }
  return { quality: 'medium', frameRate: 30, timeout: 120 };
}

/**
 * 获取 API 请求头（包含认证信息）
 */
function getAuthHeaders(): HeadersInit {
  const headers: HeadersInit = {
    'Content-Type': 'application/json',
  };

  // 从 localStorage 获取用户配置的 API Key
  const apiKey = localStorage.getItem('manimcat_api_key');
  if (apiKey) {
    headers['Authorization'] = `Bearer ${apiKey}`;
  }

  return headers;
}

/**
 * 提交动画生成请求
 */
export async function generateAnimation(request: GenerateRequest, signal?: AbortSignal): Promise<GenerateResponse> {
  // 如果请求中没有 videoConfig，则从设置中加载默认值
  const videoConfig = request.videoConfig || loadVideoConfig();

  const payload = { ...request, videoConfig };
  const response = await fetch(`${API_BASE}/generate`, {
    method: 'POST',
    headers: getAuthHeaders(),
    body: JSON.stringify(payload),
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
  const response = await fetch(`${API_BASE}/jobs/${jobId}`, {
    headers: getAuthHeaders(),
    signal,
  });

  if (!response.ok) {
    const error: ApiError = await response.json();
    throw new Error(error.error || '查询任务状态失败');
  }

  return response.json();
}
