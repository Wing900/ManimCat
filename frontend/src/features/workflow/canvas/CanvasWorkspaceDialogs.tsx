import { useI18n } from '../../../shared/i18n';
import type { PreviewImage } from './types';

interface Props {
  isDiscardConfirmOpen: boolean;
  setIsDiscardConfirmOpen: (open: boolean) => void;
  isPreviewConfirmOpen: boolean;
  previewImages: PreviewImage[];
  isExporting: boolean;
  exportError: boolean;
  requestClose: () => void;
  onClosePreview: () => void;
  onConfirmPreview: () => void;
}

export function CanvasWorkspaceDialogs({ isDiscardConfirmOpen, setIsDiscardConfirmOpen, isPreviewConfirmOpen, previewImages, isExporting, exportError, requestClose, onClosePreview, onConfirmPreview }: Props) {
  const { t } = useI18n();
  return (<>
      {/* 放弃确认弹窗 */}
      {isDiscardConfirmOpen && (
        <div className="fixed inset-0 z-[160] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-bg-primary/60 backdrop-blur-md animate-overlay-wash-in" onClick={() => setIsDiscardConfirmOpen(false)} />
          <div className="relative w-full max-w-lg rounded-[2.5rem] border border-border/5 bg-bg-secondary p-10 shadow-2xl animate-modal-pop-in">
            <div className="flex items-center justify-between mb-8">
              <div className="flex items-center gap-3">
                <div className="w-2 h-2 rounded-full bg-accent-rgb/40 animate-pulse" />
                <h2 className="text-xl font-medium text-text-primary tracking-tight">{t('canvas.discardTitle')}</h2>
              </div>
              <button
                onClick={() => setIsDiscardConfirmOpen(false)}
                className="p-2.5 text-text-secondary/50 hover:text-text-primary hover:bg-bg-primary/50 rounded-2xl transition-all"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <p className="text-text-secondary text-[15px] mb-10 leading-relaxed font-light">
              {t('canvas.discardDescription')}
            </p>

            <div className="flex gap-4">
              <button
                onClick={() => setIsDiscardConfirmOpen(false)}
                className="flex-1 py-4 text-sm text-text-secondary hover:text-text-primary bg-bg-primary/50 hover:bg-bg-tertiary rounded-2xl transition-all active:scale-95"
              >
                {t('common.cancel')}
              </button>
              <button
                onClick={() => {
                  setIsDiscardConfirmOpen(false);
                  requestClose();
                }}
                className="flex-1 py-4 text-sm text-bg-primary bg-text-primary hover:opacity-90 rounded-2xl transition-all active:scale-95 shadow-lg shadow-black/10 font-medium"
              >
                {t('common.confirm')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 导出预览弹窗 */}
      {isPreviewConfirmOpen && (
        <div className="fixed inset-0 z-[160] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-bg-primary/60 backdrop-blur-md animate-overlay-wash-in" onClick={() => !isExporting && onClosePreview()} />
          <div className="relative flex max-h-[90vh] w-full max-w-5xl flex-col overflow-hidden rounded-[2.5rem] border border-border/5 bg-bg-secondary p-10 shadow-2xl animate-modal-pop-in">
            <div className="flex items-center justify-between mb-8 shrink-0">
              <div className="flex items-center gap-3">
                <div className="w-2 h-2 rounded-full bg-accent-rgb/40 animate-pulse" />
                <h2 className="text-xl font-medium text-text-primary tracking-tight">{t('canvas.previewConfirmTitle')}</h2>
              </div>
              <button
                onClick={() => !isExporting && onClosePreview()}
                className="p-2.5 text-text-secondary/50 hover:text-text-primary hover:bg-bg-primary/50 rounded-2xl transition-all"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <p className="text-text-secondary text-[15px] mb-8 leading-relaxed font-light shrink-0">
              {t('canvas.previewConfirmDescription')}
            </p>

            <div className="grid gap-6 overflow-y-auto mb-10 px-1 py-2 md:grid-cols-2 lg:grid-cols-3">
              {previewImages.map((image, index) => (
                <div key={image.id} className="group overflow-hidden rounded-[1.75rem] border border-border/5 bg-bg-primary/50 transition-all hover:bg-bg-primary/80">
                  <div className="aspect-[16/10] overflow-hidden">
                    <img src={image.dataUrl} alt={t('canvas.previewImageAlt', { index: index + 1 })} className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.05]" />
                  </div>
                  <div className="flex items-center justify-between px-5 py-4 text-xs font-bold uppercase tracking-widest text-text-secondary/35">
                    <span>{t('canvas.previewItem', { index: index + 1 })}</span>
                    <span className="font-mono">{String(index + 1).padStart(2, '0')}</span>
                  </div>
                </div>
              ))}
            </div>

            {exportError && <p role="alert" className="mb-4 text-sm text-rose-500">{t('canvas.exportError')}</p>}
            <div className="flex justify-end gap-4 shrink-0">
              <button
                type="button"
                onClick={() => onClosePreview()}
                disabled={isExporting}
                className="px-8 py-4 text-sm text-text-secondary hover:text-text-primary bg-bg-primary/50 hover:bg-bg-tertiary rounded-2xl transition-all active:scale-95 disabled:opacity-50"
              >
                {t('common.cancel')}
              </button>
              <button
                type="button"
                onClick={onConfirmPreview}
                disabled={isExporting}
                className="px-10 py-4 text-sm text-bg-primary bg-text-primary hover:bg-accent-hover-rgb rounded-2xl transition-all active:scale-95 disabled:opacity-50 shadow-lg font-medium"
              >
                {isExporting ? (
                  <div className="flex items-center gap-2">
                    <div className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />
                    {t('canvas.uploading')}
                  </div>
                ) : t('common.confirm')}
              </button>
            </div>
          </div>
        </div>
      )}
  </>);
}
