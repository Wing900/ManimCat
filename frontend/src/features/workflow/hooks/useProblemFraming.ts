import { useCallback, useRef, useState } from 'react';
import { generateProblemFraming } from '../../../infrastructure/api/api';
import type { OutputMode, ProblemFramingPlan, Quality, ReferenceImage } from '../../../shared/types/api';
import { useI18n } from '../../../shared/i18n/index';
import { loadPrompts } from '../../prompts/hooks/usePrompts';

interface GenerationDraft {
  concept: string;
  quality: Quality;
  outputMode: OutputMode;
  referenceImages?: ReferenceImage[];
}

interface StartPlanOptions {
  request: GenerationDraft;
  feedback?: string;
}

interface RefinePlanOptions {
  feedback: string;
}

interface UseProblemFramingResult {
  status: 'idle' | 'loading' | 'ready' | 'error';
  plan: ProblemFramingPlan | null;
  error: string | null;
  draft: GenerationDraft | null;
  startPlan: (options: StartPlanOptions) => Promise<void>;
  refinePlan: (options: RefinePlanOptions) => Promise<void>;
  retryPlan: () => Promise<void>;
  updatePlan: (plan: ProblemFramingPlan) => void;
  reset: () => void;
}

export function useProblemFraming(): UseProblemFramingResult {
  const { locale, t } = useI18n();
  const [status, setStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
  const [plan, setPlan] = useState<ProblemFramingPlan | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<GenerationDraft | null>(null);
  const [feedbackHistory, setFeedbackHistory] = useState<string[]>([]);
  const abortControllerRef = useRef<AbortController | null>(null);
  const requestSequenceRef = useRef(0);

  const callPlanner = useCallback(async (
    request: GenerationDraft,
    feedback?: string,
    currentPlan?: ProblemFramingPlan | null,
    history?: string[]
  ) => {
    abortControllerRef.current?.abort();
    abortControllerRef.current = new AbortController();

    return generateProblemFraming(
      {
        concept: request.concept,
        feedback,
        feedbackHistory: history && history.length ? history : undefined,
        currentPlan: currentPlan || undefined,
        locale,
        referenceImages: request.referenceImages,
        promptOverrides: loadPrompts(locale),
      },
      abortControllerRef.current.signal
    );
  }, [locale]);

  const startPlan = useCallback(async ({ request, feedback }: StartPlanOptions) => {
    const requestId = ++requestSequenceRef.current;
    setStatus('loading');
    setError(null);
    setPlan(null);
    setDraft(request);
    const trimmedFeedback = feedback?.trim();
    const nextHistory = trimmedFeedback ? [trimmedFeedback] : [];
    setFeedbackHistory(nextHistory);

    try {
      const response = await callPlanner(request, trimmedFeedback, undefined, nextHistory);
      if (requestId !== requestSequenceRef.current) return;
      setPlan(response.plan);
      setStatus('ready');
    } catch (err) {
      if (requestId !== requestSequenceRef.current || (err instanceof Error && err.name === 'AbortError')) {
        return;
      }
      setStatus('error');
      setError(err instanceof Error ? err.message : t('generation.problemFramingFailed'));
    }
  }, [callPlanner, t]);

  const refinePlan = useCallback(async ({ feedback }: RefinePlanOptions) => {
    if (!draft) {
      return;
    }

    const requestId = ++requestSequenceRef.current;
    setStatus('loading');
    setError(null);
    const trimmedFeedback = feedback.trim();
    const nextHistory = trimmedFeedback ? [...feedbackHistory, trimmedFeedback] : feedbackHistory;

    try {
      const response = await callPlanner(draft, trimmedFeedback, plan, nextHistory);
      if (requestId !== requestSequenceRef.current) return;
      setPlan(response.plan);
      setFeedbackHistory(nextHistory);
      setStatus('ready');
    } catch (err) {
      if (requestId !== requestSequenceRef.current || (err instanceof Error && err.name === 'AbortError')) {
        return;
      }
      setStatus('error');
      setError(err instanceof Error ? err.message : t('generation.problemFramingFailed'));
    }
  }, [callPlanner, draft, feedbackHistory, plan, t]);

  const retryPlan = useCallback(async () => {
    if (!draft) return;

    const requestId = ++requestSequenceRef.current;
    setStatus('loading');
    setError(null);

    try {
      const response = await callPlanner(draft, undefined, undefined, feedbackHistory);
      if (requestId !== requestSequenceRef.current) return;
      setPlan(response.plan);
      setStatus('ready');
    } catch (err) {
      if (requestId !== requestSequenceRef.current || (err instanceof Error && err.name === 'AbortError')) {
        return;
      }
      setStatus('error');
      setError(err instanceof Error ? err.message : t('generation.problemFramingFailed'));
    }
  }, [callPlanner, draft, feedbackHistory, t]);

  const updatePlan = useCallback((nextPlan: ProblemFramingPlan) => {
    setPlan(nextPlan);
  }, []);

  const reset = useCallback(() => {
    requestSequenceRef.current += 1;
    abortControllerRef.current?.abort();
    setStatus('idle');
    setPlan(null);
    setError(null);
    setDraft(null);
    setFeedbackHistory([]);
  }, []);

  return {
    status,
    plan,
    error,
    draft,
    startPlan,
    refinePlan,
    retryPlan,
    updatePlan,
    reset,
  };
}
