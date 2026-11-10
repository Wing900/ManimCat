import { useState } from 'react';
import { useI18n } from '../../../shared/i18n/index';
import { BrowserRenderError } from '../../browser-rendering';
import type {
  BrowserRenderImagePreparedPayload,
  RenderTarget,
} from '../../../shared/types/api';
import { ImagePreview } from './ImagePreview';
import { useBrowserImageRender } from '../hooks/useBrowserImageRender';

interface BrowserImageResultProps {
  jobId: string;
  payload: BrowserRenderImagePreparedPayload;
  renderTarget: RenderTarget;
}

/**
 * Browser image output. The isolated frame is mounted off-screen; each block arrives
 * as a clean PNG and is shown through the existing image gallery, lightbox and
 * single/ZIP download UI. Partial images survive a failed block and can be retried
 * locally with the same prepared sources.
 */
export function BrowserImageResult(props: BrowserImageResultProps) {
  const [attempt, setAttempt] = useState(0);
  return (
    <BrowserImageResultRun
      key={`${props.jobId}:${props.renderTarget}:${props.payload.blocks.map((block) => block.index).join('-')}:${props.payload.resolution.width}x${props.payload.resolution.height}:${props.payload.frameRate}:${attempt}`}
      {...props}
      onRetry={() => setAttempt((current) => current + 1)}
    />
  );
}

interface BrowserImageResultRunProps extends BrowserImageResultProps {
  onRetry: () => void;
}

function BrowserImageResultRun({
  jobId,
  payload,
  renderTarget,
  onRetry,
}: BrowserImageResultRunProps) {
  const { t } = useI18n();
  const {
    containerRef,
    status,
    images,
    progress,
    error,
    configFailure,
    capabilityFailure,
  } = useBrowserImageRender(jobId, payload, renderTarget);

  const loading =
    status === 'checking' ||
    status === 'mounting' ||
    status === 'starting' ||
    status === 'rendering';
  const blocked = status === 'unconfigured' || status === 'unsupported' || status === 'error';
  const total = progress?.total ?? payload.blocks.length;
  const completed = progress?.completed ?? 0;
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
  const statusText =
    status === 'checking'
      ? t('result.browser.preparing')
      : status === 'mounting'
        ? t('result.browser.mounting')
        : status === 'starting'
          ? t('result.browser.starting')
          : t('result.browser.imageProgress', { completed, total });

  return (
    <div className="w-full">
      <div
        ref={containerRef}
        aria-hidden="true"
        className="pointer-events-none fixed left-[-20000px] top-0 h-[540px] w-[960px] overflow-hidden opacity-0"
      />

      {images.length > 0 ? (
        <div className="h-[420px]">
          <ImagePreview imageUrls={images.map((image) => image.url)} />
        </div>
      ) : null}

      {images.length === 0 && loading ? (
        <div className="relative flex h-[420px] items-center justify-center rounded-2xl bg-bg-secondary/30">
          <div className="flex max-w-sm flex-col items-center gap-3 rounded-full bg-black/55 px-5 py-3 text-center text-xs text-white/80">
            <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white/25 border-t-white/80" />
            <span>{statusText}</span>
          </div>
        </div>
      ) : null}

      {images.length === 0 && blocked ? (
        <div className="flex h-[420px] items-center justify-center rounded-2xl bg-bg-secondary/30 p-5">
          <div
            role={status === 'error' ? 'alert' : 'status'}
            className="max-w-md rounded-2xl border border-border/10 bg-bg-secondary/80 p-6 text-center shadow-xl"
          >
            <p className="text-sm font-medium text-text-primary">
              {status === 'error'
                ? t('result.browser.errorTitle')
                : status === 'unsupported'
                  ? capabilityMessage
                  : configMessage}
            </p>
            {status === 'error' && errorMessage ? (
              <p className="mt-2 break-words text-xs leading-relaxed text-text-secondary/70">
                {errorMessage}
              </p>
            ) : null}
            {errorDetail ? (
              <pre className="mt-3 max-h-32 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-bg-primary/50 p-2 text-left text-[10px] leading-relaxed text-text-secondary/50">
                {errorDetail}
              </pre>
            ) : null}
            {status === 'error' || status === 'unsupported' ? (
              <div className="mt-4">
                <button
                  type="button"
                  onClick={onRetry}
                  className="rounded-full bg-text-primary px-4 py-2 text-xs font-medium text-bg-primary transition-opacity hover:opacity-90"
                >
                  {status === 'unsupported'
                    ? t('result.browser.capabilityRetry')
                    : t('result.browser.retry')}
                </button>
                <p className="mt-2 text-[10px] leading-relaxed text-text-secondary/50">
                  {t('result.browser.imageRetryHint')}
                </p>
              </div>
            ) : null}
          </div>
        </div>
      ) : null}

      {images.length > 0 && loading ? (
        <p className="mt-2 text-center text-[11px] leading-relaxed text-text-secondary/60">
          {statusText}
        </p>
      ) : null}

      {images.length > 0 && status === 'error' ? (
        <div
          role="alert"
          className="mt-3 rounded-xl border border-red-300/30 bg-red-500/10 px-4 py-3 text-xs leading-relaxed text-red-700 dark:text-red-300"
        >
          <p>
            {t('result.browser.imagePartial', {
              completed: images.length,
              total: payload.blocks.length,
            })}
          </p>
          {errorMessage ? <p className="mt-1 break-words opacity-80">{errorMessage}</p> : null}
          <button
            type="button"
            onClick={onRetry}
            className="mt-3 rounded-full bg-text-primary px-4 py-2 text-xs font-medium text-bg-primary transition-opacity hover:opacity-90"
          >
            {t('result.browser.retry')}
          </button>
        </div>
      ) : null}
    </div>
  );
}
