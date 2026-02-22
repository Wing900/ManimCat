import type { ReferenceImage } from '../../types/api';

interface ReferenceImageListProps {
  images: ReferenceImage[];
  loading: boolean;
  onRemove: (index: number) => void;
}

export function ReferenceImageList({ images, loading, onRemove }: ReferenceImageListProps) {
  if (images.length === 0) {
    return null;
  }

  return (
    <div className="flex flex-wrap gap-2">
      {images.map((img, idx) => (
        <div key={idx} className="relative group">
          <img
            src={img.url}
            alt={`参考图片 ${idx + 1}`}
            className="w-16 h-16 object-cover rounded-lg border border-border/50"
          />
          <button
            type="button"
            onClick={() => onRemove(idx)}
            disabled={loading}
            className="absolute -top-1.5 -right-1.5 w-4 h-4 bg-red-500 text-white rounded-full opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center text-[10px] leading-none"
          >
            ×
          </button>
        </div>
      ))}
    </div>
  );
}
