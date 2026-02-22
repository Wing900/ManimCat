import { CustomSelect } from '../CustomSelect';
import type { Quality, VideoConfig } from '../../types/api';
import { DEFAULT_SETTINGS } from '../../lib/settings';

interface VideoSettingsTabProps {
  videoConfig: VideoConfig;
  onUpdate: (updates: Partial<VideoConfig>) => void;
}

export function VideoSettingsTab({ videoConfig, onUpdate }: VideoSettingsTabProps) {
  return (
    <>
      <CustomSelect
        options={[
          { value: 'low' as Quality, label: '低 (480p)' },
          { value: 'medium' as Quality, label: '中 (720p)' },
          { value: 'high' as Quality, label: '高 (1080p)' },
        ]}
        value={videoConfig.quality}
        onChange={(value) => onUpdate({ quality: value })}
        label="默认值"
      />

      <CustomSelect
        options={[
          { value: 15, label: '15 fps' },
          { value: 30, label: '30 fps' },
          { value: 60, label: '60 fps' },
        ]}
        value={videoConfig.frameRate}
        onChange={(value) => onUpdate({ frameRate: value })}
        label="帧率"
      />

      <CustomSelect
        options={[
          { value: 60, label: '1 分钟' },
          { value: 120, label: '2 分钟' },
          { value: 180, label: '3 分钟' },
          { value: 300, label: '5 分钟' },
          { value: 600, label: '10 分钟' },
        ]}
        value={videoConfig.timeout ?? DEFAULT_SETTINGS.video.timeout}
        onChange={(value) => onUpdate({ timeout: value })}
        label="生成超时"
      />
    </>
  );
}
