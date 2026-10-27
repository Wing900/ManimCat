// 结果操作区：下载（含画质确认）、AI 修改、生成新内容

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { OutputMode, Quality } from '../../../shared/types/api';
import { useI18n } from '../../../shared/i18n/index';
import { useModalTransition } from '../../../shared/hooks/useModalTransition';

interface ResultActionsProps {
  videoUrl: string;
  quality: Quality;
  frameRate?: number;
  outputMode: OutputMode;
  isBusy?: boolean;
  onAiModify?: () => void;
  onNewContent?: () => void;
  onRerender?: (quality?: Quality, frameRate?: number) => void;
}

type Dialog = 'download' | 'new' | null;

const RESOLUTION_LABELS: Record<Quality, string> = {
  low: '480p',
  medium: '720p',
  high: '1080p'
};

/**
 * AI modify: a rounded frame with its top-right corner left open, and one diagonal
 * stroke entering through that opening — editing the picture inside the frame.
 */
function AiModifyMark() {
  return (
    <svg
      aria-hidden="true"
      className="w-[18px] h-[18px]"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      viewBox="0 0 24 24"
    >
      <path d="M14.4 4.6H7.6a3 3 0 0 0-3 3v8.8a3 3 0 0 0 3 3h8.8a3 3 0 0 0 3-3V9.6" />
      <path d="M20.8 3.2 13.4 10.6" />
    </svg>
  );
}

export function ResultActions({
  videoUrl,
  quality,
  frameRate,
  outputMode,
  isBusy = false,
  onAiModify,
  onNewContent,
  onRerender
}: ResultActionsProps) {
  const { t } = useI18n();
  const [dialog, setDialog] = useState<Dialog>(null);
  const lastDialogRef = useRef<Dialog>(null);
  const { shouldRender, isExiting } = useModalTransition(dialog !== null);

  if (dialog !== null) {
    lastDialogRef.current = dialog;
  }
  const activeDialog = dialog ?? lastDialogRef.current;
  const resolution = RESOLUTION_LABELS[quality];
  const canUpgrade = Boolean(onRerender) && quality !== 'high';

  const closeDialog = () => setDialog(null);

  useEffect(() => {
    if (dialog === null) return undefined;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setDialog(null);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [dialog]);

  const triggerDownload = () => {
    if (!videoUrl) return;
    const a = document.createElement('a');
    a.href = videoUrl;
    a.download = `manim-animation-${new Date().toISOString().slice(0, 10)}.mp4`;
    document.body.appendChild(a);
    a.click();
    a.remove();
  };

  const openDownload = () => {
    if (!videoUrl || isBusy) return;
    if (quality === 'high') {
      triggerDownload();
      return;
    }
    setDialog('download');
  };

  const handleDownload = () => {
    triggerDownload();
    setDialog(null);
  };

  const handleUpgrade = () => {
    setDialog(null);
    onRerender?.('high', frameRate);
  };

  const handleConfirmNew = () => {
    setDialog(null);
    onNewContent?.();
  };

  const modal = shouldRender && activeDialog !== null ? createPortal(
    <div className="fixed inset-0 z-[120] flex items-center justify-center p-4">
      <div
        className={`absolute inset-0 bg-bg-primary/60 backdrop-blur-md ${
          isExiting ? 'animate-overlay-wash-out' : 'animate-overlay-wash-in'
        }`}
        onClick={closeDialog}
      />

      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="resultActionsDialogTitle"
        className={`relative w-full max-w-md bg-bg-secondary rounded-[2.5rem] p-8 shadow-2xl border border-border/5 ${
          isExiting ? 'animate-modal-pop-out' : 'animate-modal-pop-in'
        }`}
      >
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <div className="w-2 h-2 rounded-full bg-accent-rgb/40 animate-pulse" />
            <h2
              id="resultActionsDialogTitle"
              className="text-lg font-medium text-text-primary tracking-tight"
            >
              {activeDialog === 'download'
                ? t('result.downloadTitle')
                : t('result.newContentConfirmTitle')}
            </h2>
          </div>
          <button
            type="button"
            onClick={closeDialog}
            aria-label={t('common.close')}
            className="p-2.5 text-text-secondary/50 hover:text-text-primary hover:bg-bg-primary/50 rounded-2xl transition-all"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {activeDialog === 'download' ? (
          <>
            <p className="text-text-secondary text-[15px] mb-3 leading-relaxed font-light">
              {t('result.downloadQualityHint', { resolution })}
            </p>
            {canUpgrade && (
              <p className="text-text-secondary/50 text-xs mb-8 leading-relaxed">
                {t('result.renderHigherHint')}
              </p>
            )}

            <div className="flex flex-wrap gap-3">
              <button
                type="button"
                onClick={closeDialog}
                className="flex-1 min-w-[7rem] py-3 px-5 text-sm text-text-secondary hover:text-text-primary bg-bg-primary/50 hover:bg-bg-tertiary rounded-full transition-all active:scale-95"
              >
                {t('common.cancel')}
              </button>
              {canUpgrade && (
                <button
                  type="button"
                  onClick={handleUpgrade}
                  className="flex-1 min-w-[7rem] py-3 px-5 text-sm text-text-primary bg-bg-primary/50 hover:bg-bg-tertiary border border-border/10 rounded-full transition-all active:scale-95"
                >
                  {t('result.renderHigher')}
                </button>
              )}
              <button
                type="button"
                onClick={handleDownload}
                className="flex-1 min-w-[9rem] inline-flex items-center justify-center h-10 px-5 text-sm font-medium text-white bg-accent hover:bg-accent-hover rounded-full transition-all active:scale-95"
              >
                {t('result.downloadCurrent')}
              </button>
            </div>
          </>
        ) : (
          <>
            <p className="text-text-secondary text-[15px] mb-8 leading-relaxed font-light">
              {t('result.newContentConfirmDescription')}
            </p>

            <div className="flex gap-3">
              <button
                type="button"
                onClick={closeDialog}
                className="flex-1 py-3 px-5 text-sm text-text-secondary hover:text-text-primary bg-bg-primary/50 hover:bg-bg-tertiary rounded-full transition-all active:scale-95"
              >
                {t('common.cancel')}
              </button>
              <button
                type="button"
                onClick={handleConfirmNew}
                disabled={isBusy}
                className="flex-1 py-3 px-5 text-sm font-medium text-white bg-accent hover:bg-accent-hover rounded-full transition-all active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed shadow-sm shadow-accent/20"
              >
                {t('common.confirm')}
              </button>
            </div>
          </>
        )}
      </div>
    </div>,
    document.body
  ) : null;

  return (
    <>
      <div className="mt-5 mb-3 flex flex-wrap items-center justify-center gap-4">
        {outputMode === 'video' && (
          <button
            type="button"
            onClick={openDownload}
            disabled={isBusy || !videoUrl}
            className="inline-flex items-center justify-center gap-2 h-10 px-5 text-sm font-medium text-white bg-accent hover:bg-accent-hover rounded-full transition-all active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <svg aria-hidden="true" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={1.6} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v11m0 0l-4-4m4 4l4-4M5 19h14" />
            </svg>
            {t('result.downloadVideo')}
          </button>
        )}
        {onAiModify && (
          <button
            type="button"
            onClick={onAiModify}
            disabled={isBusy}
            className="inline-flex items-center justify-center gap-2 h-10 px-3 text-sm text-text-secondary hover:text-text-primary hover:bg-bg-secondary rounded-full transition-all active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <AiModifyMark />
            {t('result.aiModify')}
          </button>
        )}
        {onNewContent && (
          <button
            type="button"
            onClick={() => setDialog('new')}
            disabled={isBusy}
            className="inline-flex items-center justify-center gap-2 h-10 px-3 text-sm text-text-secondary hover:text-text-primary hover:bg-bg-secondary rounded-full transition-all active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <svg aria-hidden="true" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={1.6} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 5v14M5 12h14" />
            </svg>
            {t('result.newContent')}
          </button>
        )}
      </div>

      {modal}
    </>
  );
}
