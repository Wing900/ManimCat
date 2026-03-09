import { useState, useCallback, useRef, useEffect } from 'react';
import { generateAnimation, getJobStatus, cancelJob, modifyAnimation } from '../lib/api';
import { pickNextCustomProfile } from '../lib/custom-ai';
import { loadSettings } from '../lib/settings';
import { loadPrompts } from './usePrompts';
import type { GenerateRequest, JobResult, ProcessingStage, ModifyRequest } from '../types/api';
import { localizeApiMessage, useI18n } from '../i18n';

interface UseGenerationReturn {
  status: 'idle' | 'processing' | 'completed' | 'error';
  result: JobResult | null;
  error: string | null;
  jobId: string | null;
  stage: ProcessingStage;
  generate: (request: GenerateRequest) => Promise<void>;
  renderWithCode: (request: GenerateRequest & { code: string }) => Promise<void>;
  modifyWithAI: (request: ModifyRequest) => Promise<void>;
  reset: () => void;
  cancel: () => void;
}

const POLL_INTERVAL = 1000;

function getTimeoutConfig(): number {
  return loadSettings().video.timeout || 1200;
}

export function useGeneration(): UseGenerationReturn {
  const { t } = useI18n();
  const [status, setStatus] = useState<'idle' | 'processing' | 'completed' | 'error'>('idle');
  const [result, setResult] = useState<JobResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [jobId, setJobId] = useState<string | null>(null);
  const [stage, setStage] = useState<ProcessingStage>('analyzing');

  const pollCountRef = useRef(0);
  const pollIntervalRef = useRef<number | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const jobAuthKeyRef = useRef<string | undefined>(undefined);

  const requestCancel = useCallback(async (id: string | null, authKey?: string) => {
    if (!id) {
      return;
    }

    try {
      await cancelJob(id, authKey ? { authKeyOverride: authKey } : undefined);
    } catch (err) {
      console.warn(t('generation.cancelFailed'), err);
    }
  }, [t]);

  useEffect(() => {
    return () => {
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current);
      }
      abortControllerRef.current?.abort();
    };
  }, []);

  const updateStage = useCallback((count: number) => {
    if (count < 5) {
      setStage('analyzing');
    } else if (count < 15) {
      setStage('generating');
    } else if (count < 25) {
      setStage('refining');
    } else if (count < 60) {
      setStage('rendering');
    } else {
      setStage('still-rendering');
    }
  }, []);

  const startPolling = useCallback((id: string) => {
    pollCountRef.current = 0;
    setJobId(id);

    const maxPollCount = getTimeoutConfig();

    pollIntervalRef.current = window.setInterval(async () => {
      pollCountRef.current++;

      try {
        const authKey = jobAuthKeyRef.current;
        const data = await getJobStatus(
          id,
          abortControllerRef.current?.signal,
          authKey ? { authKeyOverride: authKey } : undefined
        );

        if (data.status === 'completed') {
          if (pollIntervalRef.current) {
            clearInterval(pollIntervalRef.current);
          }
          setStatus('completed');
          setResult(data);
        } else if (data.status === 'failed') {
          if (pollIntervalRef.current) {
            clearInterval(pollIntervalRef.current);
          }
          setStatus('error');
          if (data.cancel_reason) {
            setError(t('generation.cancelled', { reason: data.cancel_reason }));
          } else {
            setError(data.error ? localizeApiMessage(data.error) : t('generation.failed'));
          }
        } else {
          if (data.stage) {
            setStage(data.stage);
          } else {
            updateStage(pollCountRef.current);
          }
        }

        if (pollCountRef.current >= maxPollCount) {
          if (pollIntervalRef.current) {
            clearInterval(pollIntervalRef.current);
          }
          await requestCancel(id, jobAuthKeyRef.current);
          setStatus('error');
          setError(t('generation.timeout', { seconds: maxPollCount }));
        }
      } catch (err) {
        if (err instanceof Error && err.name === 'AbortError') {
          return;
        }

        if (err instanceof Error && (err.message.includes('ECONNREFUSED') || err.message.includes('Failed to fetch'))) {
          console.error('Backend disconnected, stop polling');
          if (pollIntervalRef.current) {
            clearInterval(pollIntervalRef.current);
          }
          setStatus('error');
          setError(t('generation.backendDisconnected'));
          return;
        }

        console.error('轮询错误:', err);
        await requestCancel(id, jobAuthKeyRef.current);

        if (
          err instanceof Error &&
          (
            err.message.includes('未找到任务') ||
            err.message.includes('失效') ||
            err.message.includes('Job not found') ||
            err.message.includes('expired')
          )
        ) {
          if (pollIntervalRef.current) {
            clearInterval(pollIntervalRef.current);
            pollIntervalRef.current = null;
          }
          setStatus('error');
          setError(t('generation.jobExpired'));
          return;
        }
      }
    }, POLL_INTERVAL);
  }, [requestCancel, t, updateStage]);

  const renderWithCode = useCallback(async (request: GenerateRequest & { code: string }) => {
    setStatus('processing');
    setError(null);
    setResult(null);
    setStage('rendering');
    pollCountRef.current = 0;
    abortControllerRef.current = new AbortController();

    try {
      const promptOverrides = loadPrompts();
      const selectedProfile = pickNextCustomProfile();
      const customApiConfig = selectedProfile?.customApiConfig || undefined;
      const requestAuthKey = selectedProfile?.manimcatApiKey || undefined;
      const response = await generateAnimation(
        { ...request, promptOverrides, customApiConfig },
        abortControllerRef.current.signal,
        requestAuthKey ? { authKeyOverride: requestAuthKey } : undefined
      );
      jobAuthKeyRef.current = requestAuthKey;
      startPolling(response.jobId);
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        return;
      }
      setStatus('error');
      setError(err instanceof Error ? err.message : t('generation.rerenderFailed'));
    }
  }, [startPolling, t]);

  const modifyWithAI = useCallback(async (request: ModifyRequest) => {
    setStatus('processing');
    setError(null);
    setResult(null);
    setStage('generating');
    pollCountRef.current = 0;
    abortControllerRef.current = new AbortController();

    try {
      const promptOverrides = loadPrompts();
      const selectedProfile = pickNextCustomProfile();
      const customApiConfig = selectedProfile?.customApiConfig || undefined;
      const requestAuthKey = selectedProfile?.manimcatApiKey || undefined;
      const response = await modifyAnimation(
        { ...request, promptOverrides, customApiConfig },
        abortControllerRef.current.signal,
        requestAuthKey ? { authKeyOverride: requestAuthKey } : undefined
      );
      jobAuthKeyRef.current = requestAuthKey;
      startPolling(response.jobId);
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        return;
      }
      setStatus('error');
      setError(err instanceof Error ? err.message : t('generation.modifyFailed'));
    }
  }, [startPolling, t]);

  const generate = useCallback(async (request: GenerateRequest) => {
    setStatus('processing');
    setError(null);
    setResult(null);
    setStage('analyzing');
    pollCountRef.current = 0;
    abortControllerRef.current = new AbortController();

    try {
      const promptOverrides = loadPrompts();
      const selectedProfile = pickNextCustomProfile();
      const customApiConfig = selectedProfile?.customApiConfig || undefined;
      const requestAuthKey = selectedProfile?.manimcatApiKey || undefined;

      const response = await generateAnimation(
        { ...request, promptOverrides, customApiConfig },
        abortControllerRef.current.signal,
        requestAuthKey ? { authKeyOverride: requestAuthKey } : undefined
      );
      jobAuthKeyRef.current = requestAuthKey;
      startPolling(response.jobId);

    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        return;
      }
      setStatus('error');
      setError(err instanceof Error ? err.message : t('generation.requestFailed'));
    }
  }, [startPolling, t]);

  const reset = useCallback(() => {
    setStatus('idle');
    setError(null);
    setResult(null);
    setJobId(null);
    setStage('analyzing');
    jobAuthKeyRef.current = undefined;
    if (pollIntervalRef.current) {
      clearInterval(pollIntervalRef.current);
    }
    abortControllerRef.current?.abort();
  }, []);

  const cancel = useCallback(() => {
    if (pollIntervalRef.current) {
      clearInterval(pollIntervalRef.current);
    }
    void requestCancel(jobId, jobAuthKeyRef.current);
    abortControllerRef.current?.abort();
    setStatus('idle');
    setError(null);
    setJobId(null);
    setStage('analyzing');
    jobAuthKeyRef.current = undefined;
  }, [jobId, requestCancel]);

  return {
    status,
    result,
    error,
    jobId,
    stage,
    generate,
    renderWithCode,
    modifyWithAI,
    reset,
    cancel,
  };
}
