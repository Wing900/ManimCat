import { CustomSelect } from '../../shared/components/CustomSelect';
import type { Quality, VideoConfig } from '../../shared/types/api';
import { DEFAULT_SETTINGS } from '../../infrastructure/storage/settings';
import { useI18n } from '../../shared/i18n/index';

interface VideoSettingsProps {
  videoConfig: VideoConfig;
  onUpdate: (updates: Partial<VideoConfig>) => void;
}

export function VideoSettings({ videoConfig, onUpdate }: VideoSettingsProps) {
  const { t } = useI18n();
  const bgmEnabled = videoConfig.bgm ?? DEFAULT_SETTINGS.video.bgm;

  return (
    <div className="max-w-xl flex flex-col gap-6">
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
          { value: 600, label: t('settings.video.timeout.600') },
          { value: 1200, label: t('settings.video.timeout.1200') },
          { value: 1800, label: t('settings.video.timeout.1800') },
          { value: 3000, label: t('settings.video.timeout.3000') },
        ]}
        value={videoConfig.timeout ?? DEFAULT_SETTINGS.video.timeout}
        onChange={(value) => onUpdate({ timeout: value })}
        label={t('settings.video.timeout')}
      />

      <div className="flex items-center justify-between px-3 py-2.5 rounded-lg bg-bg-secondary/30">
        <span className="text-sm text-text-primary">{t('settings.video.bgm')}</span>
        <button
          type="button"
          role="switch"
          aria-checked={bgmEnabled}
          onClick={() => onUpdate({ bgm: !bgmEnabled })}
          className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full transition-colors duration-200 ${
            bgmEnabled ? 'bg-accent' : 'bg-text-secondary/30'
          }`}
        >
          <span
            className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow-sm ring-0 transition-transform duration-200 mt-0.5 ${
              bgmEnabled ? 'translate-x-[18px]' : 'translate-x-0.5'
            }`}
          />
        </button>
      </div>
    </div>
  );
}
