import type { ReferenceImage } from '../../types/api';
import { useI18n } from '../../i18n';

interface ReferenceImageListProps {
  images: ReferenceImage[];
  loading: boolean;
  onRemove: (index: number) => void;
  variant?: 'default' | 'minimal';
}

export function ReferenceImageList({
  images,
  loading,
  onRemove,
  variant = 'default',
}: ReferenceImageListProps) {
  const { t } = useI18n();
  const isMinimal = variant === 'minimal';

  if (images.length === 0) {
    return null;
  }

  return (
    <div className={`flex flex-wrap ${isMinimal ? 'gap-3 pb-4' : 'gap-2'}`}>
      {images.map((img, idx) => (
        <div key={idx} className="relative group">
          <img
            src={img.url}
            alt={t('reference.alt', { index: idx + 1 })}
            className={isMinimal
              ? 'h-12 w-12 object-cover bg-black/[0.03] opacity-75 transition-opacity duration-300 group-hover:opacity-100'
              : 'h-16 w-16 rounded-lg border border-border/50 object-cover'}
          />
          <button
            type="button"
            onClick={() => onRemove(idx)}
            disabled={loading}
            className={isMinimal
              ? 'absolute -right-1 -top-1 flex h-4 w-4 items-center justify-center rounded-full bg-black/55 text-[10px] leading-none text-white opacity-0 transition-opacity group-hover:opacity-100'
              : 'absolute -right-1.5 -top-1.5 flex h-4 w-4 items-center justify-center rounded-full bg-red-500 text-[10px] leading-none text-white opacity-0 transition-opacity group-hover:opacity-100'}
          >
            ×
          </button>
        </div>
      ))}
    </div>
  );
}
