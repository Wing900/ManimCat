import type {
  GenerateRequest,
  GenerateResponse,
  JobResult,
  ApiError,
  PromptDefaults,
  ModifyRequest,
  UsageMetricsResponse,
  PromptLocale,
  ProblemFramingRequest,
  ProblemFramingResponse
} from '../types/api';
import { loadSettings } from './settings';
import { localizeApiMessage, translate } from '../i18n/runtime';

const API_BASE = '/api';

/** 获取或生成浏览器端唯一标识，用于隔离历史记录 */
function getClientId(): string {
  const KEY = 'manimcat_client_id';
  let id = localStorage.getItem(KEY);
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem(KEY, id);
  }
  return id;
}

interface RequestAuthOptions {
  authKeyOverride?: string;
}

function getAuthHeaders(contentType = 'application/json', options: RequestAuthOptions = {}): HeadersInit {
  const headers: HeadersInit = {};
  if (contentType) {
    headers['Content-Type'] = contentType;
  }

  const apiKey = options.authKeyOverride || localStorage.getItem('manimcat_api_key');
  if (apiKey) {
    headers['Authorization'] = `Bearer ${apiKey}`;
  }

  return headers;
}

async function parseApiErrorMessage(response: Response, fallbackMessage: string): Promise<string> {
  try {
    const text = await response.text();
    if (!text) {
      return fallbackMessage;
    }

    const error = JSON.parse(text) as ApiError;
    return error.error ? localizeApiMessage(error.error) : fallbackMessage;
  } catch {
    return fallbackMessage;
  }
}

export async function modifyAnimation(
  request: ModifyRequest,
  signal?: AbortSignal,
  options: RequestAuthOptions = {}
): Promise<GenerateResponse> {
  const videoConfig = request.videoConfig || loadSettings().video;
  const payload = { ...request, videoConfig };

  const response = await fetch(`${API_BASE}/modify`, {
    method: 'POST',
    headers: { ...getAuthHeaders('application/json', options), 'x-client-id': getClientId() },
    body: JSON.stringify(payload),
    signal,
  });

  if (!response.ok) {
    throw new Error(await parseApiErrorMessage(response, translate('api.modifyFailed')));
  }

  return response.json();
}

interface UploadReferenceImageResponse {
  success: boolean;
  url: string;
  relativeUrl: string;
  mimeType: string;
  size: number;
}

export async function uploadReferenceImage(file: File, signal?: AbortSignal): Promise<UploadReferenceImageResponse> {
  const response = await fetch(`${API_BASE}/reference-images`, {
    method: 'POST',
    headers: getAuthHeaders(file.type || 'application/octet-stream'),
    body: file,
    signal,
  });

  if (!response.ok) {
    let message = translate('api.uploadFailed');
    try {
      const error: ApiError = await response.json();
      message = error.error ? localizeApiMessage(error.error) : message;
    } catch {
      // ignore json parse errors and keep default message
    }
    throw new Error(message);
  }

  return response.json();
}

export async function generateAnimation(
  request: GenerateRequest,
  signal?: AbortSignal,
  options: RequestAuthOptions = {}
): Promise<GenerateResponse> {
  const videoConfig = request.videoConfig || loadSettings().video;
  const payload = { ...request, videoConfig };

  const response = await fetch(`${API_BASE}/generate`, {
    method: 'POST',
    headers: { ...getAuthHeaders('application/json', options), 'x-client-id': getClientId() },
    body: JSON.stringify(payload),
    signal,
  });

  if (!response.ok) {
    throw new Error(await parseApiErrorMessage(response, translate('api.generateFailed')));
  }

  return response.json();
}

export async function generateProblemFraming(
  request: ProblemFramingRequest,
  signal?: AbortSignal,
  options: RequestAuthOptions = {}
): Promise<ProblemFramingResponse> {
  const response = await fetch(`${API_BASE}/problem-frame`, {
    method: 'POST',
    headers: { ...getAuthHeaders('application/json', options), 'x-client-id': getClientId() },
    body: JSON.stringify(request),
    signal,
  });

  if (!response.ok) {
    throw new Error(await parseApiErrorMessage(response, translate('api.problemFramingFailed')));
  }

  return response.json();
}

export async function getPromptDefaults(locale?: PromptLocale, signal?: AbortSignal): Promise<PromptDefaults> {
  const query = locale ? `?locale=${encodeURIComponent(locale)}` : '';
  const response = await fetch(`${API_BASE}/prompts/defaults${query}`, {
    headers: getAuthHeaders(),
    signal,
  });

  if (!response.ok) {
    throw new Error(await parseApiErrorMessage(response, 'Failed to load prompt defaults'));
  }

  return response.json();
}

export async function getJobStatus(
  jobId: string,
  signal?: AbortSignal,
  options: RequestAuthOptions = {}
): Promise<JobResult> {
  const response = await fetch(`${API_BASE}/jobs/${jobId}`, {
    headers: { ...getAuthHeaders('application/json', options), 'x-client-id': getClientId() },
    signal,
  });

  if (!response.ok) {
    throw new Error(await parseApiErrorMessage(response, translate('api.jobStatusFailed')));
  }

  return response.json();
}

export async function cancelJob(jobId: string, options: RequestAuthOptions = {}): Promise<void> {
  const response = await fetch(`${API_BASE}/jobs/${jobId}/cancel`, {
    method: 'POST',
    headers: { ...getAuthHeaders('application/json', options), 'x-client-id': getClientId() },
  });

  if (!response.ok) {
    throw new Error(await parseApiErrorMessage(response, translate('api.cancelFailed')));
  }
}

export async function getUsageMetrics(days = 7, signal?: AbortSignal): Promise<UsageMetricsResponse> {
  const response = await fetch(`${API_BASE}/metrics/usage?days=${days}`, {
    headers: getAuthHeaders(),
    signal,
  });

  if (!response.ok) {
    throw new Error(await parseApiErrorMessage(response, translate('api.usageFailed')));
  }

  return response.json();
}

