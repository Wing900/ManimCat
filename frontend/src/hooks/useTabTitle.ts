import { useEffect } from 'react';
import type { ProcessingStage } from '../types/api';
import { useI18n } from '../i18n';

type GenerationStatus = 'idle' | 'processing' | 'completed' | 'error';

function getStageTitle(stage: ProcessingStage, t: ReturnType<typeof useI18n>['t']): string {
  switch (stage) {
    case 'analyzing':
      return t('tab.stage.analyzing');
    case 'generating':
      return t('tab.stage.generating');
    case 'refining':
      return t('tab.stage.refining');
    case 'rendering':
    case 'still-rendering':
      return t('tab.stage.rendering');
    default:
      return t('tab.stage.default');
  }
}

function getTabTitle(status: GenerationStatus, stage: ProcessingStage, t: ReturnType<typeof useI18n>['t']): string {
  if (status === 'processing') {
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
