import type {
  GenerateRequest,
  GenerateResponse,
  JobResult,
  ApiError,
  PromptDefaults,
  ModifyRequest,
  PromptLocale,
  ProblemFramingRequest,
  ProblemFramingResponse
} from '../../shared/types/api';
import { loadSettings } from '../storage/settings';
import { getConnectionHeaders, withConnectionProvider } from '../../features/connection/connection-request';
import { localizeApiMessage, translate } from '../../shared/i18n/runtime';

export const API_BASE = '/api';

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

export async function modifyAnimation(request: ModifyRequest, signal?: AbortSignal): Promise<GenerateResponse> {
  const videoConfig = request.videoConfig || loadSettings().video;
  const payload = withConnectionProvider({ ...request, videoConfig });

  const response = await fetch(`${API_BASE}/modify`, {
    method: 'POST',
    headers: { ...getConnectionHeaders('application/json'), 'x-client-id': getClientId() },
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
    headers: getConnectionHeaders(file.type || 'application/octet-stream'),
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
  signal?: AbortSignal
): Promise<GenerateResponse> {
  const videoConfig = request.videoConfig || loadSettings().video;
  const payload = withConnectionProvider({ ...request, videoConfig });

  const response = await fetch(`${API_BASE}/generate`, {
    method: 'POST',
    headers: { ...getConnectionHeaders('application/json'), 'x-client-id': getClientId() },
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
  signal?: AbortSignal
): Promise<ProblemFramingResponse> {
  const payload = withConnectionProvider({ ...request });

  const response = await fetch(`${API_BASE}/problem-frame`, {
    method: 'POST',
    headers: { ...getConnectionHeaders('application/json'), 'x-client-id': getClientId() },
    body: JSON.stringify(payload),
    signal,
  });

  if (!response.ok) {
    throw new Error(await parseApiErrorMessage(response, translate('api.problemFramingFailed')));
  }

  const data = (await response.json()) as ProblemFramingResponse;
  if (!isUsableProblemFramingPlan(data?.plan)) {
    // The planner must return its own content. An empty plan is a failure, never a card.
    throw new Error(translate('api.problemFramingEmpty'));
  }

  return data;
}

/**
 * Shape guard for the planning card. The backend already rejects plans it would have to invent
 * (src/workflow/problem-framing/parser.ts), so this only catches drift that would render an empty card.
 */
function isUsableProblemFramingPlan(plan: ProblemFramingResponse['plan'] | undefined): boolean {
  if (!plan || typeof plan !== 'object') {
    return false;
  }
  if (!plan.headline?.trim() || !plan.summary?.trim()) {
    return false;
  }
  if (!Array.isArray(plan.steps) || plan.steps.length === 0) {
    return false;
  }
  return plan.steps.every((step) => Boolean(step?.title?.trim() && step?.content?.trim()));
}

export async function getPromptDefaults(locale?: PromptLocale, signal?: AbortSignal): Promise<PromptDefaults> {
  const query = locale ? `?locale=${encodeURIComponent(locale)}` : '';
  const response = await fetch(`${API_BASE}/prompts/defaults${query}`, {
    headers: getConnectionHeaders(),
    signal,
  });

  if (!response.ok) {
    throw new Error(await parseApiErrorMessage(response, 'Failed to load prompt defaults'));
  }

  return response.json();
}

export async function getJobStatus(jobId: string, signal?: AbortSignal): Promise<JobResult> {
  // Job status carries no provider config: it only needs identity, which the credential header gives.
  const response = await fetch(`${API_BASE}/jobs/${jobId}`, {
    headers: { ...getConnectionHeaders('application/json'), 'x-client-id': getClientId() },
    signal,
  });

  if (!response.ok) {
    throw new Error(await parseApiErrorMessage(response, translate('api.jobStatusFailed')));
  }

  return response.json();
}

export async function cancelJob(jobId: string): Promise<void> {
  const response = await fetch(`${API_BASE}/jobs/${jobId}/cancel`, {
    method: 'POST',
    headers: { ...getConnectionHeaders('application/json'), 'x-client-id': getClientId() },
  });

  if (!response.ok) {
    throw new Error(await parseApiErrorMessage(response, translate('api.cancelFailed')));
  }
}
