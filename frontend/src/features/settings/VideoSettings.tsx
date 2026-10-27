import { CustomSelect } from '../../shared/components/CustomSelect';
import type { Quality, VideoConfig } from '../../shared/types/api';
import type { TranslationKey } from '../../shared/i18n/index';
import { DEFAULT_NARRATION, DEFAULT_SETTINGS, NARRATION_RATES, NARRATION_VOICES } from '../../infrastructure/storage/settings';
import { useI18n } from '../../shared/i18n/index';

const NARRATION_RATE_KEYS: Record<(typeof NARRATION_RATES)[number], TranslationKey> = {
  '-10%': 'settings.video.narration.rate.slow',
  '+0%': 'settings.video.narration.rate.normal',
  '+20%': 'settings.video.narration.rate.fast'
};

interface VideoSettingsProps {
  videoConfig: VideoConfig;
  onUpdate: (updates: Partial<VideoConfig>) => void;
}

export function VideoSettings({ videoConfig, onUpdate }: VideoSettingsProps) {
  const { t } = useI18n();
  const narration = videoConfig.narration ?? DEFAULT_NARRATION;

  const updateNarration = (updates: Partial<typeof narration>) => {
    onUpdate({ narration: { ...narration, ...updates } });
  };

  return (
    <div className="flex flex-col gap-6">
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

      <div className="flex flex-col gap-4">
        <div className="flex items-center justify-between rounded-xl bg-bg-secondary/40 px-4 py-3">
          <span className="text-sm text-text-primary">{t('settings.video.narration')}</span>
          <button
            type="button"
            role="switch"
            aria-checked={narration.enabled}
            onClick={() => updateNarration({ enabled: !narration.enabled })}
            className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors duration-300 ease-ui ${
              narration.enabled ? 'bg-ink/70' : 'bg-text-secondary/25'
            }`}
          >
            <span
              className={`pointer-events-none inline-block h-5 w-5 rounded-full bg-white shadow-sm transition-transform duration-300 ease-spring ${
                narration.enabled ? 'translate-x-[22px]' : 'translate-x-0.5'
              }`}
            />
          </button>
        </div>

        {narration.enabled ? (
          <>
            <CustomSelect
              options={NARRATION_VOICES.map((voice) => ({
                value: voice,
                label: t(`settings.video.narration.voice.${voice}` as TranslationKey)
              }))}
              value={narration.voice}
              onChange={(voice) => updateNarration({ voice })}
              label={t('settings.video.narration.voice')}
            />

            <CustomSelect
              options={NARRATION_RATES.map((rate) => ({
                value: rate,
                label: t(NARRATION_RATE_KEYS[rate])
              }))}
              value={narration.rate}
              onChange={(rate) => updateNarration({ rate })}
              label={t('settings.video.narration.rate')}
            />

            <p className="px-1 text-xs leading-relaxed text-text-secondary/60">
              {t('settings.video.narration.hint')}
            </p>
          </>
        ) : null}
      </div>
    </div>
  );
}
