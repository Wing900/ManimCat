import { useEffect } from 'react';
import type { ProcessingStage } from '../types/api';
import { useI18n } from '../i18n/index';

type GenerationStatus = 'idle' | 'processing' | 'cancelling' | 'completed' | 'error';

function getStageTitle(stage: ProcessingStage, t: ReturnType<typeof useI18n>['t']): string {
  switch (stage) {
    case 'queued':
      return t('tab.stage.queued');
    case 'analyzing':
      return t('tab.stage.analyzing');
    case 'designing':
      return t('tab.stage.designing');
    case 'generating':
      return t('tab.stage.generating');
    case 'refining':
      return t('tab.stage.refining');
    case 'rendering':
    case 'still-rendering':
      return t('tab.stage.rendering');
    case 'retrying':
      return t('tab.stage.retrying');
    default:
      return t('tab.stage.default');
  }
}

function getTabTitle(status: GenerationStatus, stage: ProcessingStage, t: ReturnType<typeof useI18n>['t']): string {
  if (status === 'processing' || status === 'cancelling') {
    return t('tab.processing', { stage: getStageTitle(stage, t) });
  }
  if (status === 'completed') {
    return t('tab.completed');
  }
  if (status === 'error') {
    return t('tab.error');
  }
  return t('tab.base');
}

export function useTabTitle(status: GenerationStatus, stage: ProcessingStage): void {
  const { t } = useI18n();

  useEffect(() => {
    const baseTitle = t('tab.base');
    document.title = getTabTitle(status, stage, t);

    return () => {
      document.title = baseTitle;
    };
  }, [status, stage, t]);
}
