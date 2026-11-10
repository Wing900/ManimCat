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
import { deriveSubtitleUrl, videoJobId } from '../../shared/media/subtitle-url';
import { getConnectionHeaders, withConnectionProvider } from '../../features/connection/connection-request';
import { localizeApiMessage, translate } from '../../shared/i18n/runtime';
import {
  createRequestDeadline,
  readResponseBytesBounded,
  RequestDeadlineError,
  ResponseTooLargeError,
} from './request-deadline';

export const API_BASE = '/api';
const MAX_BROWSER_NARRATION_BYTES = 64 * 1024 * 1024;
const BROWSER_NARRATION_FETCH_TIMEOUT_MS = 60_000;
const SAFE_NARRATION_SHA256 = /^[a-f0-9]{64}$/;

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

function toHex(value: ArrayBuffer): string {
  return Array.from(new Uint8Array(value), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

/** The only browser narration asset URL the host will fetch for a job. */
export function browserRenderNarrationPath(jobId: string, sha256: string): string {
  if (!SAFE_NARRATION_SHA256.test(sha256)) {
    throw new Error(translate('browser.narrationReferenceInvalid'));
  }
  return `${API_BASE}/jobs/${encodeURIComponent(jobId)}/browser-assets/narration-${sha256}.wav`;
}

async function discardResponseBody(response: Response): Promise<void> {
  try {
    await response.body?.cancel();
  } catch {
    // The body is no longer used; a stream that is already closed is fine.
  }
}

/**
 * Fetch the prepared WAV through the existing authenticated API boundary. The job
 * access record and connection credential do the authorization; no path or token is
 * accepted from the caller beyond the server-issued reference. The independent deadline
 * covers both the response headers and the bounded body read, and composes the caller's
 * unmount signal instead of replacing it.
 */
export async function fetchBrowserRenderNarration(
  jobId: string,
  audioUrl: string,
  expectedBytes: number | undefined,
  expectedSha256: string,
  signal?: AbortSignal,
): Promise<ArrayBuffer> {
  const expectedUrl = browserRenderNarrationPath(jobId, expectedSha256);
  if (audioUrl !== expectedUrl) {
    throw new Error(translate('browser.narrationReferenceInvalid'));
  }
  const deadline = createRequestDeadline(signal, BROWSER_NARRATION_FETCH_TIMEOUT_MS);
  let response: Response | null = null;
  try {
    response = await fetch(audioUrl, {
      headers: { ...getConnectionHeaders(), 'x-client-id': getClientId() },
      signal: deadline.signal,
    });
    if (deadline.timedOut()) throw new RequestDeadlineError();
    if (!response.ok) {
      await discardResponseBody(response);
      throw new Error(translate('browser.narrationDownloadFailed'));
    }
    const contentType = response.headers.get('content-type') ?? '';
    if (!contentType.toLowerCase().includes('audio/wav')) {
      await discardResponseBody(response);
      throw new Error(translate('browser.narrationDownloadFailed'));
    }
    const declared = Number(response.headers.get('content-length') ?? '0');
    if (Number.isFinite(declared) && declared > MAX_BROWSER_NARRATION_BYTES) {
      await discardResponseBody(response);
      throw new ResponseTooLargeError();
    }
    const bytes = await readResponseBytesBounded(response, MAX_BROWSER_NARRATION_BYTES);
    if (deadline.timedOut()) throw new RequestDeadlineError();
    if (bytes.byteLength <= 0 || bytes.byteLength > MAX_BROWSER_NARRATION_BYTES) {
      throw new ResponseTooLargeError();
    }
    if (expectedBytes !== undefined && bytes.byteLength !== expectedBytes) {
      throw new Error(translate('browser.narrationDownloadFailed'));
    }
    if (!globalThis.crypto?.subtle) {
      throw new Error(translate('browser.narrationIntegrityFailed'));
    }
    const actualSha256 = toHex(await crypto.subtle.digest('SHA-256', bytes));
    if (deadline.timedOut()) throw new RequestDeadlineError();
    if (actualSha256 !== expectedSha256) {
      throw new Error(translate('browser.narrationIntegrityFailed'));
    }
    return bytes;
  } catch (error) {
    if (deadline.timedOut()) {
      throw new Error(translate('browser.narrationTimedOut'));
    }
    if (error instanceof ResponseTooLargeError) {
      throw new Error(translate('browser.narrationTooLarge'));
    }
    throw error;
  } finally {
    deadline.dispose();
    if (deadline.timedOut() && response && !response.bodyUsed) {
      await discardResponseBody(response);
    }
  }
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

/** HEAD the VTT sidecar: the web player derives it from the video URL. */
export async function hasSubtitleSidecar(videoUrl: string): Promise<boolean> {
  const subtitleUrl = deriveSubtitleUrl(videoUrl)
  if (!subtitleUrl) {
    return false;
  }
  try {
    const response = await fetch(subtitleUrl, { method: 'HEAD' });
    return response.ok;
  } catch {
    return false;
  }
}

/** Ask the backend to paint the VTT onto the picture; returns the burned MP4 URL. */
export async function requestBurnedVideo(videoUrl: string): Promise<string> {
  const jobId = videoJobId(videoUrl);
  if (!jobId) {
    throw new Error(translate('result.burnFailed'));
  }
  const response = await fetch(`${API_BASE}/videos/${encodeURIComponent(jobId)}/hardsub`, {
    method: 'POST',
    headers: { 'x-client-id': getClientId() },
  });
  if (!response.ok) {
    throw new Error(await parseApiErrorMessage(response, translate('result.burnFailed')));
  }
  const payload = (await response.json()) as { url?: unknown };
  if (typeof payload.url !== 'string' || !payload.url) {
    throw new Error(translate('result.burnFailed'));
  }
  return payload.url;
}
