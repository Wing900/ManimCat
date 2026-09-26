import { useState, useCallback, useRef, useEffect } from 'react';
import { generateAnimation, getJobStatus, cancelJob, modifyAnimation } from '../lib/api';
import { loadSettings } from '../lib/settings';
import { getActiveProvider, providerToCustomApiConfig } from '../lib/ai-providers';
import { loadPrompts } from './usePrompts';
import type { GenerateRequest, GenerateResponse, JobResult, ProcessingStage, ModifyRequest } from '../types/api';
import { useI18n } from '../i18n';
import { localizeApiMessage } from '../i18n/runtime';

type GenerationStatus = 'idle' | 'processing' | 'cancelling' | 'completed' | 'error';

interface UseGenerationReturn {
  status: GenerationStatus;
  result: JobResult | null;
  error: string | null;
  jobId: string | null;
  stage: ProcessingStage;
  submittedAt: string | null;
  generate: (request: GenerateRequest) => Promise<void>;
  renderWithCode: (request: GenerateRequest & { code: string }) => Promise<void>;
  modifyWithAI: (request: ModifyRequest) => Promise<void>;
  reset: () => void;
  cancel: () => void;
  cancelAndReset: () => void;
}

interface PersistedActiveJob {
  jobId: string;
}

const POLL_INTERVAL = 1000;
const MAX_TRANSIENT_POLL_ERRORS = 5;
const ACTIVE_JOB_STORAGE_KEY = 'manimcat_active_job';

function hasIncompleteCustomProvider(provider: { apiUrl: string; apiKey: string; model: string } | null): boolean {
  if (!provider) {
    return false;
  }
  const hasAny = Boolean(provider.apiUrl.trim() || provider.apiKey.trim() || provider.model.trim());
  const hasRequired = Boolean(provider.apiUrl.trim() && provider.apiKey.trim() && provider.model.trim());
  return hasAny && !hasRequired;
}

function readPersistedActiveJob(): PersistedActiveJob | null {
  const raw = sessionStorage.getItem(ACTIVE_JOB_STORAGE_KEY);
  if (!raw) {
    return null;
  }

  try {
    const parsed = JSON.parse(raw) as PersistedActiveJob;
    if (!parsed.jobId) {
      return null;
    }
    return {
      jobId: parsed.jobId,
    };
  } catch {
    return null;
  }
}

export function useGeneration(): UseGenerationReturn {
  const { t, locale } = useI18n();
  const [status, setStatus] = useState<GenerationStatus>('idle');
  const [result, setResult] = useState<JobResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [jobId, setJobId] = useState<string | null>(null);
  const [stage, setStage] = useState<ProcessingStage>('analyzing');
  const [submittedAt, setSubmittedAt] = useState<string | null>(null);

  const pollCountRef = useRef(0);
  const pollIntervalRef = useRef<number | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const transientPollErrorCountRef = useRef(0);
  const latestRevisionRef = useRef(0);
  const pollInFlightRef = useRef(false);
  const pollSessionRef = useRef(0);

  const clearPolling = useCallback(() => {
    if (pollIntervalRef.current) {
      clearInterval(pollIntervalRef.current);
      pollIntervalRef.current = null;
    }
  }, []);

  const persistActiveJob = useCallback((nextJobId: string) => {
    sessionStorage.setItem(ACTIVE_JOB_STORAGE_KEY, JSON.stringify({
      jobId: nextJobId,
    }));
  }, []);

  const clearActiveJob = useCallback(() => {
    sessionStorage.removeItem(ACTIVE_JOB_STORAGE_KEY);
  }, []);

  const syncTransientStage = useCallback((nextJobId: string, nextStage: ProcessingStage, nextSubmittedAt: string | null) => {
    setStage(nextStage);
    setSubmittedAt(nextSubmittedAt);
    persistActiveJob(nextJobId);
  }, [persistActiveJob]);

  const startPolling = useCallback((nextJobId: string, initialStage: ProcessingStage, initialSubmittedAt: string | null) => {
    clearPolling();
    const pollSession = ++pollSessionRef.current;
    pollCountRef.current = 0;
    transientPollErrorCountRef.current = 0;
    latestRevisionRef.current = 0;
    pollInFlightRef.current = false;
    setJobId(nextJobId);
    setStatus('processing');
    setError(null);
    setResult(null);
    syncTransientStage(nextJobId, initialStage, initialSubmittedAt);

    pollIntervalRef.current = window.setInterval(async () => {
      if (pollInFlightRef.current) {
        return;
      }
      pollInFlightRef.current = true;
      pollCountRef.current += 1;

      try {
        const data = await getJobStatus(nextJobId, abortControllerRef.current?.signal);
        if (pollSession !== pollSessionRef.current) {
          return;
        }
        transientPollErrorCountRef.current = 0;
        if (typeof data.revision === 'number') {
          if (data.revision < latestRevisionRef.current) {
            return;
          }
          latestRevisionRef.current = data.revision;
        }

        if (data.status === 'completed') {
          clearPolling();
          clearActiveJob();
          setStatus('completed');
          setResult(data);
          setSubmittedAt(data.submitted_at ?? initialSubmittedAt);
          return;
        }

        if (data.status === 'failed') {
          clearPolling();
          clearActiveJob();
          setStatus('error');
          setSubmittedAt(data.submitted_at ?? initialSubmittedAt);
          if (data.cancel_reason) {
            setError(t('generation.cancelled', { reason: data.cancel_reason }));
          } else {
            setError(data.error ? localizeApiMessage(data.error) : t('generation.failed'));
          }
          return;
        }

        const nextSubmittedAt = data.submitted_at ?? initialSubmittedAt;
        if (data.stage) {
          syncTransientStage(nextJobId, data.stage, nextSubmittedAt);
        } else {
          setSubmittedAt(nextSubmittedAt);
          persistActiveJob(nextJobId);
        }
      } catch (err) {
        if (pollSession !== pollSessionRef.current) {
          return;
        }
        if (err instanceof Error && err.name === 'AbortError') {
          return;
        }

        if (err instanceof Error && (err.message.includes('ECONNREFUSED') || err.message.includes('Failed to fetch'))) {
          transientPollErrorCountRef.current += 1;
          if (transientPollErrorCountRef.current <= MAX_TRANSIENT_POLL_ERRORS) {
            console.warn('Backend fetch failed, retry polling', {
              attempt: transientPollErrorCountRef.current,
              jobId: nextJobId,
              error: err.message,
            });
          }
          return;
        }

        console.error('轮询错误:', err);
        if (
          err instanceof Error &&
          (
            err.message.includes('未找到任务') ||
            err.message.includes('失效') ||
            err.message.includes('Job not found') ||
            err.message.includes('expired')
          )
        ) {
          clearPolling();
          clearActiveJob();
          setStatus('error');
          setSubmittedAt(null);
          setError(t('generation.jobExpired'));
          return;
        }

        clearPolling();
        setStatus('error');
        setSubmittedAt(null);
        setError(err instanceof Error ? localizeApiMessage(err.message) : t('api.jobStatusFailed'));
      } finally {
        if (pollSession === pollSessionRef.current) {
          pollInFlightRef.current = false;
        }
      }
    }, POLL_INTERVAL);
  }, [clearActiveJob, clearPolling, persistActiveJob, syncTransientStage, t]);

  useEffect(() => {
    abortControllerRef.current = new AbortController();
    const persisted = readPersistedActiveJob();
    if (persisted) {
      startPolling(persisted.jobId, 'analyzing', null);
    }

    return () => {
      clearPolling();
      abortControllerRef.current?.abort();
    };
  }, [clearPolling, startPolling]);

  const submitGeneration = useCallback(async (
    request: GenerateRequest | ModifyRequest,
    executor: (payload: GenerateRequest | ModifyRequest, signal: AbortSignal) => Promise<GenerateResponse>,
    initialStage: ProcessingStage,
    fallbackMessage: string,
  ) => {
    clearPolling();
    pollSessionRef.current += 1;
    pollInFlightRef.current = false;
    setStatus('processing');
    setError(null);
    setResult(null);
    setStage(initialStage);
    pollCountRef.current = 0;
    latestRevisionRef.current = 0;
    abortControllerRef.current?.abort();
    abortControllerRef.current = new AbortController();

    try {
      const promptOverrides = loadPrompts(locale);
      const settings = loadSettings();
      const activeProvider = getActiveProvider(settings.api);
      const customApiConfig = providerToCustomApiConfig(activeProvider);
      if (hasIncompleteCustomProvider(activeProvider) && !customApiConfig) {
        throw new Error(t('settings.test.needUrlAndKey'));
      }

      const response = await executor(
        { ...request, promptOverrides, customApiConfig },
        abortControllerRef.current.signal,
      );
      startPolling(response.jobId, initialStage, response.submittedAt ?? null);
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        return;
      }
      clearActiveJob();
      setStatus('error');
      setSubmittedAt(null);
      setError(err instanceof Error ? err.message : fallbackMessage);
    }
  }, [clearActiveJob, clearPolling, locale, startPolling, t]);

  const generate = useCallback(async (request: GenerateRequest) => {
    await submitGeneration(
      request,
      (payload, signal) => generateAnimation(payload as GenerateRequest, signal),
      'analyzing',
      t('generation.requestFailed'),
    );
  }, [submitGeneration, t]);

  const renderWithCode = useCallback(async (request: GenerateRequest & { code: string }) => {
    await submitGeneration(
      request,
      (payload, signal) => generateAnimation(payload as GenerateRequest, signal),
      'rendering',
      t('generation.rerenderFailed'),
    );
  }, [submitGeneration, t]);

  const modifyWithAI = useCallback(async (request: ModifyRequest) => {
    await submitGeneration(
      request,
      (payload, signal) => modifyAnimation(payload as ModifyRequest, signal),
      'generating',
      t('generation.modifyFailed'),
    );
  }, [submitGeneration, t]);

  const reset = useCallback(() => {
    clearPolling();
    pollSessionRef.current += 1;
    pollInFlightRef.current = false;
    abortControllerRef.current?.abort();
    clearActiveJob();
    setStatus('idle');
    setError(null);
    setResult(null);
    setJobId(null);
    setStage('analyzing');
    setSubmittedAt(null);
    latestRevisionRef.current = 0;
  }, [clearActiveJob, clearPolling]);

  const runCancel = useCallback((resetAfterCancel: boolean) => {
    if (!jobId) {
      if (resetAfterCancel) {
        reset();
      }
      return;
    }

    clearPolling();
    pollSessionRef.current += 1;
    pollInFlightRef.current = false;
    abortControllerRef.current?.abort();
    abortControllerRef.current = new AbortController();
    setStatus('cancelling');
    setError(null);

    void (async () => {
      try {
        await cancelJob(jobId);
        clearActiveJob();
        setResult(null);
        setJobId(null);
        setStage('analyzing');
        setSubmittedAt(null);
        if (resetAfterCancel) {
          setStatus('idle');
          setError(null);
        } else {
          setStatus('error');
          setError(t('generation.cancelled', { reason: 'Cancelled by client' }));
        }
      } catch (err) {
        console.warn(t('generation.cancelFailed'), err);
        startPolling(jobId, stage, submittedAt);
      }
    })();
  }, [clearActiveJob, clearPolling, jobId, reset, stage, startPolling, submittedAt, t]);

  const cancel = useCallback(() => {
    runCancel(false);
  }, [runCancel]);

  const cancelAndReset = useCallback(() => {
    runCancel(true);
  }, [runCancel]);

  return {
    status,
    result,
    error,
    jobId,
    stage,
    submittedAt,
    generate,
    renderWithCode,
    modifyWithAI,
    reset,
    cancel,
    cancelAndReset,
  };
}
