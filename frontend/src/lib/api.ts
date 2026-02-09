import type { GenerateRequest, GenerateResponse, JobResult, ApiError, PromptOverrides, ModifyRequest } from '../types/api';
import { loadSettings } from './settings';

const API_BASE = '/api';

function getAuthHeaders(): HeadersInit {
  const headers: HeadersInit = {
    'Content-Type': 'application/json',
  };

  const apiKey = localStorage.getItem('manimcat_api_key');
  if (apiKey) {
    headers['Authorization'] = `Bearer ${apiKey}`;
  }

  return headers;
}

export async function modifyAnimation(request: ModifyRequest, signal?: AbortSignal): Promise<GenerateResponse> {
  const videoConfig = request.videoConfig || loadSettings().video;
  const payload = { ...request, videoConfig };

  const response = await fetch(`${API_BASE}/modify`, {
    method: 'POST',
    headers: getAuthHeaders(),
    body: JSON.stringify(payload),
    signal,
  });

  if (!response.ok) {
    const error: ApiError = await response.json();
    throw new Error(error.error || 'AI 修改失败');
  }

  return response.json();
}

export async function generateAnimation(request: GenerateRequest, signal?: AbortSignal): Promise<GenerateResponse> {
  const videoConfig = request.videoConfig || loadSettings().video;
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

export async function getPromptDefaults(signal?: AbortSignal): Promise<PromptOverrides> {
  const response = await fetch(`${API_BASE}/prompts/defaults`, {
    headers: getAuthHeaders(),
    signal,
  });

  if (!response.ok) {
    const error: ApiError = await response.json();
    throw new Error(error.error || 'Failed to load prompt defaults');
  }

  return response.json();
}

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

export async function cancelJob(jobId: string): Promise<void> {
  const response = await fetch(`${API_BASE}/jobs/${jobId}/cancel`, {
    method: 'POST',
    headers: getAuthHeaders(),
  });

  if (!response.ok) {
    const error: ApiError = await response.json();
    throw new Error(error.error || '取消任务失败');
  }
}

