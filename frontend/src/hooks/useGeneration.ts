import { useState, useCallback, useRef, useEffect } from 'react';
import { generateAnimation, getJobStatus, cancelJob, modifyAnimation } from '../lib/api';
import { loadCustomConfig } from '../lib/custom-ai';
import { loadSettings } from '../lib/settings';
import { loadPrompts } from './usePrompts';
import type { GenerateRequest, JobResult, ProcessingStage, ModifyRequest } from '../types/api';

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
  return loadSettings().video.timeout || 120;
}

export function useGeneration(): UseGenerationReturn {
  const [status, setStatus] = useState<'idle' | 'processing' | 'completed' | 'error'>('idle');
  const [result, setResult] = useState<JobResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [jobId, setJobId] = useState<string | null>(null);
  const [stage, setStage] = useState<ProcessingStage>('analyzing');

  const pollCountRef = useRef(0);
  const pollIntervalRef = useRef<number | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  const requestCancel = useCallback(async (id: string | null) => {
    if (!id) {
      return;
    }

    try {
      await cancelJob(id);
    } catch (err) {
      console.warn('取消任务失败', err);
    }
  }, []);

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
        const data = await getJobStatus(id, abortControllerRef.current?.signal);

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
            setError(`任务已取消：${data.cancel_reason}`);
          } else {
            setError(data.error || '生成失败');
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
          await requestCancel(id);
          setStatus('error');
          setError(`生成超时（${maxPollCount}秒），请尝试更简单的概念或增加超时时间`);
        }
      } catch (err) {
        if (err instanceof Error && err.name === 'AbortError') {
          return;
        }

        if (err instanceof Error && (err.message.includes('ECONNREFUSED') || err.message.includes('Failed to fetch'))) {
          console.error('后端连接断开，停止轮询');
          if (pollIntervalRef.current) {
            clearInterval(pollIntervalRef.current);
          }
          setStatus('error');
          setError('后端服务已断开，请刷新页面重试');
          return;
        }

        console.error('轮询错误:', err);
        await requestCancel(id);

        if (err instanceof Error && (err.message.includes('未找到任务') || err.message.includes('失效'))) {
          if (pollIntervalRef.current) {
            clearInterval(pollIntervalRef.current);
            pollIntervalRef.current = null;
          }
          setStatus('error');
          setError('任务已失效（可能因服务重启），请重新生成');
          return;
        }
      }
    }, POLL_INTERVAL);
  }, [requestCancel, updateStage]);

  const renderWithCode = useCallback(async (request: GenerateRequest & { code: string }) => {
    setStatus('processing');
    setError(null);
    setResult(null);
    setStage('rendering');
    pollCountRef.current = 0;
    abortControllerRef.current = new AbortController();

    try {
      const promptOverrides = loadPrompts();
      const customApiConfig = loadCustomConfig() || undefined;
      const response = await generateAnimation(
        { ...request, promptOverrides, customApiConfig },
        abortControllerRef.current.signal
      );
      startPolling(response.jobId);
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        return;
      }
      setStatus('error');
      setError(err instanceof Error ? err.message : '重新渲染失败');
    }
  }, [startPolling]);

  const modifyWithAI = useCallback(async (request: ModifyRequest) => {
    setStatus('processing');
    setError(null);
    setResult(null);
    setStage('generating');
    pollCountRef.current = 0;
    abortControllerRef.current = new AbortController();

    try {
      const promptOverrides = loadPrompts();
      const customApiConfig = loadCustomConfig() || undefined;
      const response = await modifyAnimation(
        { ...request, promptOverrides, customApiConfig },
        abortControllerRef.current.signal
      );
      startPolling(response.jobId);
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        return;
      }
      setStatus('error');
      setError(err instanceof Error ? err.message : 'AI 修改失败');
    }
  }, [startPolling]);

  const generate = useCallback(async (request: GenerateRequest) => {
    setStatus('processing');
    setError(null);
    setResult(null);
    setStage('analyzing');
    pollCountRef.current = 0;
    abortControllerRef.current = new AbortController();

    try {
      const promptOverrides = loadPrompts();
      const customApiConfig = loadCustomConfig() || undefined;

      const response = await generateAnimation(
        { ...request, promptOverrides, customApiConfig },
        abortControllerRef.current.signal
      );
      startPolling(response.jobId);

    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        return;
      }
      setStatus('error');
      setError(err instanceof Error ? err.message : '生成请求失败');
    }
  }, [startPolling]);

  const reset = useCallback(() => {
    setStatus('idle');
    setError(null);
    setResult(null);
    setJobId(null);
    setStage('analyzing');
    if (pollIntervalRef.current) {
      clearInterval(pollIntervalRef.current);
    }
    abortControllerRef.current?.abort();
  }, []);

  const cancel = useCallback(() => {
    if (pollIntervalRef.current) {
      clearInterval(pollIntervalRef.current);
    }
    void requestCancel(jobId);
    abortControllerRef.current?.abort();
    setStatus('idle');
    setError(null);
    setJobId(null);
    setStage('analyzing');
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

