import { useCallback, useRef, useState } from 'react';
import { generateProblemFraming } from '../lib/api';
import { loadSettings } from '../lib/settings';
import { getActiveProvider, providerToCustomApiConfig } from '../lib/ai-providers';
import type { OutputMode, ProblemFramingPlan, Quality, ReferenceImage } from '../types/api';
import { useI18n } from '../i18n';
import { loadPrompts } from './usePrompts';

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
  reset: () => void;
}

function hasIncompleteCustomProvider(provider: { apiUrl: string; apiKey: string; model: string } | null): boolean {
  if (!provider) {
    return false;
  }
  const hasAny = Boolean(provider.apiUrl.trim() || provider.apiKey.trim() || provider.model.trim());
  const hasRequired = Boolean(provider.apiUrl.trim() && provider.apiKey.trim() && provider.model.trim());
  return hasAny && !hasRequired;
}

export function useProblemFraming(): UseProblemFramingResult {
  const { locale, t } = useI18n();
  const [status, setStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
  const [plan, setPlan] = useState<ProblemFramingPlan | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<GenerationDraft | null>(null);
  const [feedbackHistory, setFeedbackHistory] = useState<string[]>([]);
  const abortControllerRef = useRef<AbortController | null>(null);

  const callPlanner = useCallback(async (
    request: GenerationDraft,
    feedback?: string,
    currentPlan?: ProblemFramingPlan | null,
    history?: string[]
  ) => {
    abortControllerRef.current?.abort();
    abortControllerRef.current = new AbortController();

    const settings = loadSettings();
    const activeProvider = getActiveProvider(settings.api);
    const customApiConfig = providerToCustomApiConfig(activeProvider);
    if (hasIncompleteCustomProvider(activeProvider) && !customApiConfig) {
      throw new Error(t('settings.test.needUrlAndKey'));
    }

    return generateProblemFraming(
      {
        concept: request.concept,
        feedback,
        feedbackHistory: history && history.length ? history : undefined,
        currentPlan: currentPlan || undefined,
        locale,
        referenceImages: request.referenceImages,
        promptOverrides: loadPrompts(locale),
        customApiConfig: customApiConfig || undefined,
      },
      abortControllerRef.current.signal
    );
  }, [locale, t]);

  const startPlan = useCallback(async ({ request, feedback }: StartPlanOptions) => {
    setStatus('loading');
    setError(null);
    setDraft(request);
    const trimmedFeedback = feedback?.trim();
    const nextHistory = trimmedFeedback ? [trimmedFeedback] : [];
    setFeedbackHistory(nextHistory);

    try {
      const response = await callPlanner(request, trimmedFeedback, undefined, nextHistory);
      setPlan(response.plan);
      setStatus('ready');
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
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

    setStatus('loading');
    setError(null);
    const trimmedFeedback = feedback.trim();
    const nextHistory = trimmedFeedback ? [...feedbackHistory, trimmedFeedback] : feedbackHistory;

    try {
      const response = await callPlanner(draft, trimmedFeedback, plan, nextHistory);
      setPlan(response.plan);
      setFeedbackHistory(nextHistory);
      setStatus('ready');
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        return;
      }
      setStatus('error');
      setError(err instanceof Error ? err.message : t('generation.problemFramingFailed'));
    }
  }, [callPlanner, draft, feedbackHistory, plan, t]);

  const reset = useCallback(() => {
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
    reset,
  };
}
