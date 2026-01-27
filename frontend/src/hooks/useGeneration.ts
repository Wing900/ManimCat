// 生成请求 Hook

import { useState, useCallback, useRef, useEffect } from 'react';
import { generateAnimation, getJobStatus, cancelJob } from '../lib/api';
import { loadCustomConfig, generateWithCustomApi } from '../lib/custom-ai';
import { loadPrompts } from './usePrompts';
import type { GenerateRequest, JobResult, ProcessingStage, VideoConfig } from '../types/api';

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

/** 从 localStorage 加载超时配置 */
function getTimeoutConfig(): number {
  try {
    const saved = localStorage.getItem('manimcat_settings');
    if (saved) {
      const parsed = JSON.parse(saved);
      if (parsed.video?.timeout) {
        return parsed.video.timeout;
      }
    }
  } catch {
    // 忽略错误，使用默认值
  }
  return 120; // 默认 120 秒
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
    
    // 获取用户配置的超时时间
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
          // 使用后端返回的 stage，如果没有则使用前端估算的 fallback
          if (data.stage) {
            setStage(data.stage);
          } else {
            updateStage(pollCountRef.current);
          }
        }

        // 超时检查（使用用户配置的超时时间）
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

        // 如果是连接错误（后端断开），停止轮询
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

        // 如果是任务未找到 (404) 或明确的失效提示
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

  // 生成动画
  const generate = useCallback(async (request: GenerateRequest) => {
    setStatus('processing');
    setError(null);
    setResult(null);
    setStage('analyzing');
    pollCountRef.current = 0;
    abortControllerRef.current = new AbortController();

    try {
      // 加载提示词配置
      const promptOverrides = loadPrompts();

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
          { ...request, code, promptOverrides },
          abortControllerRef.current.signal
        );
        startPolling(response.jobId);
      } else {
        // 使用后端 AI
        const response = await generateAnimation(
          { ...request, promptOverrides },
          abortControllerRef.current.signal
        );
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
    reset,
    cancel,
  };
}
