// 生成请求 Hook

import { useState, useCallback, useRef, useEffect } from 'react';
import { generateAnimation, getJobStatus } from '../lib/api';
import { loadCustomConfig, generateWithCustomApi } from '../lib/custom-ai';
import type { GenerateRequest, JobResult, ProcessingStage } from '../types/api';

interface UseGenerationReturn {
  status: 'idle' | 'processing' | 'completed' | 'error';
  result: JobResult | null;
  error: string | null;
  jobId: string | null;
  stage: ProcessingStage;
  generate: (request: GenerateRequest) => Promise<void>;
  reset: () => void;
  cancel: () => void;
}

/** 轮询间隔 */
const POLL_INTERVAL = 1000;
/** 最大轮询次数（2 分钟） */
const MAX_POLL_COUNT = 120;

export function useGeneration(): UseGenerationReturn {
  const [status, setStatus] = useState<'idle' | 'processing' | 'completed' | 'error'>('idle');
  const [result, setResult] = useState<JobResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [jobId, setJobId] = useState<string | null>(null);
  const [stage, setStage] = useState<ProcessingStage>('analyzing');

  const pollCountRef = useRef(0);
  const pollIntervalRef = useRef<number | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  // 清理轮询和请求
  useEffect(() => {
    return () => {
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current);
      }
      abortControllerRef.current?.abort();
    };
  }, []);

  // 更新处理阶段
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

  // 开始轮询
  const startPolling = useCallback((id: string) => {
    pollCountRef.current = 0;
    setJobId(id);

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
          setError(data.error || '生成失败');
        } else {
          // 使用后端返回的 stage，如果没有则使用前端估算的 fallback
          if (data.stage) {
            setStage(data.stage);
          } else {
            updateStage(pollCountRef.current);
          }
        }

        // 超时检查
        if (pollCountRef.current >= MAX_POLL_COUNT) {
          if (pollIntervalRef.current) {
            clearInterval(pollIntervalRef.current);
          }
          setStatus('error');
          setError('生成超时，请尝试更简单的概念');
        }
      } catch (err) {
        if (err instanceof Error && err.name === 'AbortError') {
          return;
        }
        console.error('轮询错误:', err);
      }
    }, POLL_INTERVAL);
  }, [updateStage]);

  // 生成动画
  const generate = useCallback(async (request: GenerateRequest) => {
    setStatus('processing');
    setError(null);
    setResult(null);
    setStage('analyzing');
    pollCountRef.current = 0;
    abortControllerRef.current = new AbortController();

    try {
      // 检查是否有自定义 AI 配置
      const customConfig = loadCustomConfig();

      if (customConfig) {
        // 使用自定义 AI 生成代码
        setStage('generating');
        const code = await generateWithCustomApi(
          request.concept,
          customConfig,
          abortControllerRef.current.signal
        );

        // 发送代码到后端渲染
        setStage('rendering');
        const response = await generateAnimation(
          { ...request, code },
          abortControllerRef.current.signal
        );
        startPolling(response.jobId);
      } else {
        // 使用后端 AI
        const response = await generateAnimation(request, abortControllerRef.current.signal);
        startPolling(response.jobId);
      }
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        return;
      }
      setStatus('error');
      setError(err instanceof Error ? err.message : '生成请求失败');
    }
  }, [startPolling]);

  // 重置状态
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

  // 取消生成
  const cancel = useCallback(() => {
    if (pollIntervalRef.current) {
      clearInterval(pollIntervalRef.current);
    }
    abortControllerRef.current?.abort();
    setStatus('idle');
    setError(null);
    setJobId(null);
    setStage('analyzing');
  }, []);

  return {
    status,
    result,
    error,
    jobId,
    stage,
    generate,
    reset,
    cancel,
  };
}
