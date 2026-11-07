// 视频预览组件

import { memo } from 'react';
import { useI18n } from '../../../shared/i18n/index';
import { deriveSubtitleUrl } from '../../../shared/media/subtitle-url';

interface VideoPreviewProps {
  videoUrl: string;
}

export const VideoPreview = memo(function VideoPreview({ videoUrl }: VideoPreviewProps) {
  const { t } = useI18n();
  const subtitleUrl = deriveSubtitleUrl(videoUrl);

  return (
    <div className="w-full bg-bg-secondary/30 rounded-md overflow-hidden">
      {/* 视频播放器 */}
      <div className="aspect-video w-full bg-black flex items-center justify-center">
        <video
          src={videoUrl}
          controls
          className="w-full h-full object-contain"
        >
          {subtitleUrl ? (
            <track
              kind="subtitles"
              label={t('video.subtitles')}
              src={subtitleUrl}
              default
            />
          ) : null}
          {t('video.unsupported')}
        </video>
      </div>
    </div>
  );
});
