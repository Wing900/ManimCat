import { useState } from 'react';
import { useI18n } from '../../../shared/i18n/index';
import { LoadingSpinner } from '../../../shared/components/LoadingSpinner';
import { BrowserRenderError } from '../../browser-rendering';
import type {
  BrowserRenderVideoPreparedPayload,
  RenderTarget,
} from '../../../shared/types/api';
import { useBrowserRenderPreview } from '../hooks/useBrowserRenderPreview';

interface BrowserRenderPreviewProps {
  jobId: string;
  payload: BrowserRenderVideoPreparedPayload;
  renderTarget: RenderTarget;
}

function formatTime(seconds: number | null): string {
  if (seconds === null || !Number.isFinite(seconds) || seconds < 0) return '0:00';
  const total = Math.floor(seconds);
  const minutes = Math.floor(total / 60);
  return `${minutes}:${String(total % 60).padStart(2, '0')}`;
}

/**
 * The browser take's preview surface. It owns no server generation: if local rendering
 * fails, the prepared payload stays in the result and the retry button remounts the
 * runtime with exactly that payload.
 */
export function BrowserRenderPreview(props: BrowserRenderPreviewProps) {
  const [attempt, setAttempt] = useState(0);
  return (
    <BrowserRenderPreviewRun
      key={`${props.jobId}:${attempt}`}
      {...props}
      onRetry={() => setAttempt((current) => current + 1)}
    />
  );
}

interface BrowserRenderPreviewRunProps extends BrowserRenderPreviewProps {
  onRetry: () => void;
}

function BrowserRenderPreviewRun({
  jobId,
  payload,
  renderTarget,
  onRetry,
}: BrowserRenderPreviewRunProps) {
  const { t } = useI18n();
  const {
    containerRef,
    status,
    sessionState,
    error,
    configFailure,
    capabilityFailure,
    play,
    pause,
    seek,
  } = useBrowserRenderPreview(jobId, payload, renderTarget);

  const loading =
    status === 'checking' ||
    status === 'mounting' ||
    status === 'starting' ||
    status === 'rendering';
  const blocked =
    status === 'unconfigured' || status === 'unsupported' || status === 'error';
  const duration = sessionState?.duration ?? null;
  const currentTime = sessionState?.currentTime ?? 0;
  const isReady = Boolean(sessionState?.ready);
  const isPlaying = sessionState?.playing === true;
  const errorDetail =
    error instanceof BrowserRenderError && error.detail ? error.detail : null;
  const errorMessage =
    error instanceof BrowserRenderError && error.code === 'frame-timeout'
      ? t('result.browser.frameTimeout')
      : (error?.message ?? null);
  const configMessage =
    configFailure?.reason === 'missing'
      ? t('result.browser.unconfigured')
      : t('browser.preflight.configInvalid');
  const capabilityMessage =
    capabilityFailure?.reason === 'insecure-context'
      ? t('browser.preflight.insecure')
      : t('result.browser.unsupported');

  return (
    <div className="w-full">
      <p className="mb-2 text-[11px] leading-relaxed text-text-secondary/55">
        {t('result.browser.prepared')}
      </p>
      {loading ? (
        <div className="animate-fade-in-soft rounded-2xl bg-bg-secondary/20 p-8">
          <LoadingSpinner stage="rendering" jobId={jobId} />
        </div>
      ) : null}

      <div
        className={
          isReady || blocked
            ? 'relative aspect-video w-full overflow-hidden rounded-md bg-black animate-fade-in-soft'
            : 'pointer-events-none fixed left-[-20000px] top-0 h-[540px] w-[960px] overflow-hidden opacity-0'
        }
      >
        <div ref={containerRef} className="absolute inset-0" />

        {blocked ? (
          <div className="absolute inset-0 flex items-center justify-center p-5">
            <div
              role={status === 'error' ? 'alert' : 'status'}
              className="max-w-md rounded-2xl border border-white/10 bg-black/80 p-5 text-center text-white shadow-xl"
            >
              <p className="text-sm font-medium">
                {status === 'error'
                  ? t('result.browser.errorTitle')
                  : status === 'unsupported'
                    ? capabilityMessage
                    : configMessage}
              </p>
              {status === 'error' && errorMessage ? (
                <p className="mt-2 break-words text-xs leading-relaxed text-white/65">
                  {errorMessage}
                </p>
              ) : null}
              {errorDetail ? (
                <pre className="mt-3 max-h-32 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-white/5 p-2 text-left text-[10px] leading-relaxed text-white/45">
                  {errorDetail}
                </pre>
              ) : null}
              {status === 'error' || status === 'unsupported' ? (
                <div className="mt-4">
                  <button
                    type="button"
                    onClick={onRetry}
                    className="rounded-full bg-white/90 px-4 py-2 text-xs font-medium text-black transition-colors hover:bg-white"
                  >
                    {status === 'unsupported'
                      ? t('result.browser.capabilityRetry')
                      : t('result.browser.retry')}
                  </button>
                  <p className="mt-2 text-[10px] leading-relaxed text-white/45">
                    {t('result.browser.retryHint')}
                  </p>
                </div>
              ) : null}
            </div>
          </div>
        ) : null}
      </div>

      {isReady ? (
        <p className="mt-2 text-center text-[11px] leading-relaxed text-text-secondary/55">
          {t('result.browser.previewOnly')}
        </p>
      ) : null}

      {isReady ? (
        <div className="mt-3 flex flex-col gap-2 rounded-xl bg-bg-secondary/35 px-4 py-3">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={isPlaying ? pause : play}
              aria-label={isPlaying ? t('result.browser.pause') : t('result.browser.play')}
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-ink/70 text-white transition-opacity hover:opacity-90"
            >
              {isPlaying ? (
                <svg aria-hidden="true" viewBox="0 0 24 24" className="h-4 w-4" fill="currentColor">
                  <rect x="6" y="5" width="4" height="14" rx="1" />
                  <rect x="14" y="5" width="4" height="14" rx="1" />
                </svg>
              ) : (
                <svg aria-hidden="true" viewBox="0 0 24 24" className="ml-0.5 h-4 w-4" fill="currentColor">
                  <path d="M8 5.2v13.6L19 12z" />
                </svg>
              )}
            </button>

            <input
              type="range"
              min={0}
              max={duration && duration > 0 ? duration : 1}
              step={0.01}
              value={Math.min(currentTime, duration && duration > 0 ? duration : 1)}
              onChange={(event) => seek(Number(event.target.value))}
              aria-label={t('result.browser.timeline')}
              className="h-1.5 min-w-0 flex-1 cursor-pointer appearance-none rounded-full bg-text-secondary/25 accent-[var(--color-accent,#111)]"
            />

            <span className="shrink-0 text-[11px] tabular-nums text-text-secondary/65">
              {formatTime(currentTime)} / {formatTime(duration)}
            </span>
          </div>

          <div className="flex flex-wrap items-center gap-2 text-[11px] text-text-secondary/60">
            <span>
              {sessionState?.narration === 'included'
                ? t('result.browser.narrationIncluded')
                : t('result.browser.narrationNone')}
            </span>
            {sessionState?.audio === 'locked' ? (
              <span className="text-amber-600 dark:text-amber-400">
                {t('result.browser.audioLocked')}
              </span>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
