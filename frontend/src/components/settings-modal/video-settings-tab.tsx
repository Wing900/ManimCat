import { CustomSelect } from '../CustomSelect';
import type { Quality, VideoConfig } from '../../types/api';
import { DEFAULT_SETTINGS } from '../../lib/settings';
import { useI18n } from '../../i18n';

interface VideoSettingsTabProps {
  videoConfig: VideoConfig;
  onUpdate: (updates: Partial<VideoConfig>) => void;
}

export function VideoSettingsTab({ videoConfig, onUpdate }: VideoSettingsTabProps) {
  const { t } = useI18n();

  return (
    <>
      <CustomSelect
        options={[
          { value: 'low' as Quality, label: t('settings.video.quality.low') },
          { value: 'medium' as Quality, label: t('settings.video.quality.medium') },
          { value: 'high' as Quality, label: t('settings.video.quality.high') },
        ]}
        value={videoConfig.quality}
        onChange={(value) => onUpdate({ quality: value })}
        label={t('settings.video.quality')}
      />

      <CustomSelect
        options={[
          { value: 15, label: '15 fps' },
          { value: 30, label: '30 fps' },
          { value: 60, label: '60 fps' },
        ]}
        value={videoConfig.frameRate}
        onChange={(value) => onUpdate({ frameRate: value })}
        label={t('settings.video.frameRate')}
      />

      <CustomSelect
        options={[
          { value: 60, label: t('settings.video.timeout.60') },
          { value: 120, label: t('settings.video.timeout.120') },
          { value: 180, label: t('settings.video.timeout.180') },
          { value: 300, label: t('settings.video.timeout.300') },
          { value: 600, label: t('settings.video.timeout.600') },
          { value: 1200, label: t('settings.video.timeout.1200') },
        ]}
        value={videoConfig.timeout ?? DEFAULT_SETTINGS.video.timeout}
        onChange={(value) => onUpdate({ timeout: value })}
        label={t('settings.video.timeout')}
      />
    </>
  );
}
