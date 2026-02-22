import { useEffect, useState } from 'react';

interface ImagePreviewProps {
  imageUrls: string[];
}

export function ImagePreview({ imageUrls }: ImagePreviewProps) {
  const [activeIndex, setActiveIndex] = useState(0);

  useEffect(() => {
    setActiveIndex(0);
  }, [imageUrls.join('|')]);

  const activeImage = imageUrls[activeIndex];

  const handleDownloadAll = () => {
    imageUrls.forEach((url, index) => {
      setTimeout(() => {
        const link = document.createElement('a');
        link.href = url;
        link.download = `manim-image-${index + 1}.png`;
        link.click();
      }, index * 150);
    });
  };

  return (
    <div className="h-full flex flex-col bg-bg-secondary/30 rounded-2xl overflow-hidden">
      <div className="flex items-center justify-between px-4 py-2.5">
        <h3 className="text-xs font-medium text-text-secondary/80 uppercase tracking-wide">图片预览</h3>
        <button
          onClick={handleDownloadAll}
          disabled={imageUrls.length === 0}
          className="text-xs text-text-secondary/70 hover:text-accent transition-colors flex items-center gap-1.5 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
          </svg>
          下载全部
        </button>
      </div>

      <div className="flex-1 bg-black/90 flex items-center justify-center">
        {activeImage ? (
          <img src={activeImage} alt={`图片 ${activeIndex + 1}`} className="w-full h-full object-contain" />
        ) : (
          <p className="text-xs text-text-secondary/60">暂无图片输出</p>
        )}
      </div>

      {imageUrls.length > 1 && (
        <div className="px-3 py-2 bg-bg-secondary/40">
          <div className="flex gap-2 overflow-x-auto">
            {imageUrls.map((url, index) => (
              <button
                key={`${url}-${index}`}
                type="button"
                onClick={() => setActiveIndex(index)}
                className={`shrink-0 rounded-md overflow-hidden border transition-all ${
                  index === activeIndex ? 'border-accent' : 'border-border/50 opacity-80 hover:opacity-100'
                }`}
              >
                <img
                  src={url}
                  alt={`缩略图 ${index + 1}`}
                  className="w-16 h-12 object-cover"
                />
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
