// 视频预览组件

interface VideoPreviewProps {
  videoUrl: string;
}

export function VideoPreview({ videoUrl }: VideoPreviewProps) {
  const handleDownload = () => {
    const link = document.createElement('a');
    link.href = videoUrl;
    link.download = `manim-animation-${Date.now()}.mp4`;
    link.click();
  };

  return (
    <div className="h-full flex flex-col bg-bg-secondary/30 rounded-2xl overflow-hidden">
      {/* 顶部工具栏 */}
      <div className="flex items-center justify-between px-4 py-2.5">
        <h3 className="text-xs font-medium text-text-secondary/80 uppercase tracking-wide">动画预览</h3>
        <button
          onClick={handleDownload}
          className="text-xs text-text-secondary/70 hover:text-accent transition-colors flex items-center gap-1.5"
        >
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
          </svg>
          下载
        </button>
      </div>

      {/* 视频播放器 */}
      <div className="flex-1 bg-black flex items-center justify-center">
        <video
          src={videoUrl}
          controls
          className="w-full h-full object-contain"
        >
          您的浏览器不支持视频播放。
        </video>
      </div>
    </div>
  );
}
