// 结果操作区：下载（含画质确认）、AI 修改、生成新内容

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import type { OutputMode, Quality } from '../../../shared/types/api';
import { useI18n } from '../../../shared/i18n/index';
import { useModalTransition } from '../../../shared/hooks/useModalTransition';
import { hasSubtitleSidecar, requestBurnedVideo } from '../../../infrastructure/api/api';

interface ResultActionsProps {
  videoUrl: string;
  hardsubUrl?: string;
  quality: Quality;
  frameRate?: number;
  outputMode: OutputMode;
  isBusy?: boolean;
  /** Browser takes are preview-only; no MP4 or hardsub artifact exists. */
  browserPreview?: boolean;
  onAiModify?: () => void;
  onNewContent?: () => void;
  onRerender?: (quality?: Quality, frameRate?: number, burnSubtitles?: boolean) => void;
}

type Dialog = 'download' | 'downloadFinal' | 'new' | null;
type CaptionState = 'unknown' | 'yes' | 'no';

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
  hardsubUrl,
  quality,
  frameRate,
  outputMode,
  isBusy = false,
  browserPreview = false,
  onAiModify,
  onNewContent,
  onRerender
}: ResultActionsProps) {
  const { t } = useI18n();
  const [dialog, setDialog] = useState<Dialog>(null);
  // Kept after close so the exit animation still has content to render.
  const [activeDialog, setActiveDialog] = useState<Exclude<Dialog, null>>('download');
  const [burnChecked, setBurnChecked] = useState(false);
  const [burning, setBurning] = useState(false);
  const [burnError, setBurnError] = useState<string | null>(null);
  const [captions, setCaptions] = useState<CaptionState>('unknown');
  const { shouldRender, isExiting } = useModalTransition(dialog !== null);

  const openDialog = (next: Exclude<Dialog, null>) => {
    setActiveDialog(next);
    setDialog(next);
  };
  const resolution = RESOLUTION_LABELS[quality];
  const canUpgrade = Boolean(onRerender) && quality !== 'high';

  useEffect(() => {
    if (browserPreview || !videoUrl) {
      return undefined;
    }
    let cancelled = false;
    void hasSubtitleSidecar(videoUrl).then((exists) => {
      if (!cancelled) {
        setCaptions(exists ? 'yes' : 'no');
      }
    });
    return () => {
      cancelled = true;
    };
  }, [browserPreview, videoUrl]);

  const closeDialog = () => {
    if (!burning) {
      setDialog(null);
    }
  };

  useEffect(() => {
    if (dialog === null) return undefined;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !burning) {
        setDialog(null);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [dialog, burning]);

  const triggerDownload = (url: string) => {
    if (!url) return;
    const a = document.createElement('a');
    a.href = url;
    a.download = `manim-animation-${new Date().toISOString().slice(0, 10)}.mp4`;
    document.body.appendChild(a);
    a.click();
    a.remove();
  };

  const openDownload = async () => {
    if (!videoUrl || isBusy) return;
    if (hardsubUrl) {
      triggerDownload(hardsubUrl);
      return;
    }
    if (quality !== 'high') {
      setBurnChecked(false);
      setBurnError(null);
      openDialog('download');
      return;
    }
    const hasCaptions = captions === 'no'
      ? false
      : captions === 'yes'
        ? true
        : await hasSubtitleSidecar(videoUrl);
    if (!hasCaptions) {
      triggerDownload(videoUrl);
      return;
    }
    setBurnChecked(false);
    setBurnError(null);
    openDialog('downloadFinal');
  };

  const burnAndDownload = async () => {
    setBurning(true);
    setBurnError(null);
    try {
      const url = await requestBurnedVideo(videoUrl);
      triggerDownload(url);
      setDialog(null);
    } catch {
      setBurnError(t('result.burnFailed'));
    } finally {
      setBurning(false);
    }
  };

  const handleDownload = () => {
    if (burnChecked && captions === 'yes') {
      void burnAndDownload();
      return;
    }
    triggerDownload(videoUrl);
    setDialog(null);
  };

  const handleUpgrade = () => {
    const burn = burnChecked && captions === 'yes';
    setDialog(null);
    onRerender?.('high', frameRate, burn);
  };

  const handleConfirmNew = () => {
    setDialog(null);
    onNewContent?.();
  };

  const modal = shouldRender ? createPortal(
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
              {activeDialog === 'new'
                ? t('result.newContentConfirmTitle')
                : t('result.downloadTitle')}
            </h2>
          </div>
          <button
            type="button"
            onClick={closeDialog}
            disabled={burning}
            aria-label={t('common.close')}
            className="p-2.5 text-text-secondary/50 hover:text-text-primary hover:bg-bg-primary/50 rounded-2xl transition-all disabled:opacity-50"
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
              <p className="text-text-secondary/50 text-xs mb-5 leading-relaxed">
                {t('result.renderHigherHint')}
              </p>
            )}

            {captions === 'yes' && (
              <div className="mb-6 flex items-center justify-between gap-4">
                <div className="min-w-0">
                  <span className="block text-sm text-text-primary">{t('result.burnSubtitlesLabel')}</span>
                  <span className="block text-xs text-text-secondary/60 mt-0.5 leading-relaxed">
                    {t('result.burnSubtitlesHint')}
                  </span>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={burnChecked}
                  aria-label={t('result.burnSubtitlesLabel')}
                  disabled={burning}
                  onClick={() => setBurnChecked((checked) => !checked)}
                  className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors duration-300 ease-ui disabled:opacity-50 ${
                    burnChecked ? 'bg-ink/70' : 'bg-text-secondary/25'
                  }`}
                >
                  <span
                    className={`pointer-events-none inline-block h-5 w-5 rounded-full bg-white shadow-sm transition-transform duration-300 ease-spring ${
                      burnChecked ? 'translate-x-[22px]' : 'translate-x-0.5'
                    }`}
                  />
                </button>
              </div>
            )}

            {burnError && (
              <p className="mb-4 text-xs text-red-500/90">{burnError}</p>
            )}

            <div className="flex flex-wrap gap-3">
              <button
                type="button"
                onClick={closeDialog}
                disabled={burning}
                className="flex-1 min-w-[7rem] py-3 px-5 text-sm text-text-secondary hover:text-text-primary bg-bg-primary/50 hover:bg-bg-tertiary rounded-full transition-all active:scale-95 disabled:opacity-50"
              >
                {t('common.cancel')}
              </button>
              {canUpgrade && (
                <button
                  type="button"
                  onClick={handleUpgrade}
                  disabled={burning}
                  className="flex-1 min-w-[7rem] py-3 px-5 text-sm text-text-primary bg-bg-primary/50 hover:bg-bg-tertiary border border-border/10 rounded-full transition-all active:scale-95 disabled:opacity-50"
                >
                  {t('result.renderHigher')}
                </button>
              )}
              <button
                type="button"
                onClick={handleDownload}
                disabled={burning}
                className="flex-1 min-w-[9rem] inline-flex items-center justify-center h-10 px-5 text-sm font-medium text-white bg-accent hover:bg-accent-hover rounded-full transition-all active:scale-95 disabled:opacity-60"
              >
                {burning ? t('result.burning') : t('result.downloadCurrent')}
              </button>
            </div>
          </>
        ) : activeDialog === 'downloadFinal' ? (
          <>
            <p className="text-text-secondary text-[15px] mb-8 leading-relaxed font-light">
              {t('result.downloadFinalHint', { resolution })}
            </p>

            {burnError && (
              <p className="mb-4 text-xs text-red-500/90">{burnError}</p>
            )}

            <div className="flex flex-wrap gap-3">
              <button
                type="button"
                onClick={closeDialog}
                disabled={burning}
                className="flex-1 min-w-[7rem] py-3 px-5 text-sm text-text-secondary hover:text-text-primary bg-bg-primary/50 hover:bg-bg-tertiary rounded-full transition-all active:scale-95 disabled:opacity-50"
              >
                {t('common.cancel')}
              </button>
              <button
                type="button"
                onClick={() => {
                  triggerDownload(videoUrl);
                  setDialog(null);
                }}
                disabled={burning}
                className="flex-1 min-w-[8rem] py-3 px-5 text-sm text-text-primary bg-bg-primary/50 hover:bg-bg-tertiary border border-border/10 rounded-full transition-all active:scale-95 disabled:opacity-50"
              >
                {t('result.downloadCurrent')}
              </button>
              <button
                type="button"
                onClick={() => void burnAndDownload()}
                disabled={burning}
                className="flex-1 min-w-[9rem] inline-flex items-center justify-center h-10 px-5 text-sm font-medium text-white bg-accent hover:bg-accent-hover rounded-full transition-all active:scale-95 disabled:opacity-60"
              >
                {burning ? t('result.burning') : t('result.burnAndDownload')}
              </button>
            </div>
          </>
        ) : (
          <>
            <p className="text-text-secondary text-[15px] mb-8 leading-relaxed font-light">
              {browserPreview
                ? t('result.newContentConfirmDescriptionBrowser')
                : t('result.newContentConfirmDescription')}
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
        {outputMode === 'video' && !browserPreview && (
          <button
            type="button"
            onClick={() => void openDownload()}
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
            onClick={() => openDialog('new')}
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
