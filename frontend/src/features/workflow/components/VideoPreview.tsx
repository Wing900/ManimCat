// 视频预览组件

import { memo } from 'react';
import { useI18n } from '../../../shared/i18n/index';

interface VideoPreviewProps {
  videoUrl: string;
}

export const VideoPreview = memo(function VideoPreview({ videoUrl }: VideoPreviewProps) {
  const { t } = useI18n();

  return (
    <div className="w-full bg-bg-secondary/30 rounded-2xl overflow-hidden">
      {/* 视频播放器 */}
      <div className="aspect-video w-full bg-black flex items-center justify-center">
        <video
          src={videoUrl}
          controls
          className="w-full h-full object-contain"
        >
          {t('video.unsupported')}
        </video>
      </div>
    </div>
  );
});
