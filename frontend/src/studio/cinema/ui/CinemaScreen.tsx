import { useEffect, useState } from 'react'
import type { TranslationKey } from '../../../i18n/messages'
import { useI18n } from '../../../i18n'
import type { StudioCinemaScreenState } from './cinema-labels'

/**
 * The video screen (task 11C2).
 *
 * It renders one thing: the Scene's public playable locator. It never builds an `src` from metadata,
 * `sourcePath` or an attachment path, and a playback problem is reported as a playback problem — the
 * Render keeps whatever status the server gave it.
 */

export interface CinemaScreenProps {
  state: StudioCinemaScreenState
  sceneIndex: number
  playableUrl: string | null
  mediaKind: 'video' | 'image' | null
  /** True when a newer render is still running behind an already playable result. */
  hasNewerWorkBehindResult: boolean
  activeRenderStatusKey: TranslationKey | null
  refreshPausedReasonKey: TranslationKey | null
  onResumeRefresh: () => void
  onReconcile: () => void
}

export function CinemaScreen({
  state,
  sceneIndex,
  playableUrl,
  mediaKind,
  hasNewerWorkBehindResult,
  activeRenderStatusKey,
  refreshPausedReasonKey,
  onResumeRefresh,
  onReconcile,
}: CinemaScreenProps) {
  const { t } = useI18n()
  const [playbackFailed, setPlaybackFailed] = useState(false)
  const [reloadToken, setReloadToken] = useState(0)

  // A different locator is a different result: the failure of the old one does not carry over.
  useEffect(() => {
    setPlaybackFailed(false)
  }, [playableUrl])

  const placeholder = (titleKey: TranslationKey, hintKey: TranslationKey) => (
    <div className="flex h-full flex-col items-center justify-center gap-2 text-center">
      <p className="text-sm text-text-primary/70">{t(titleKey)}</p>
      <p className="max-w-sm text-xs text-text-secondary/60">{t(hintKey)}</p>
    </div>
  )

  return (
    <section
      className="relative flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-black/5 bg-black/85 dark:border-white/10"
      aria-label={t('studio.cinema.screenLabel', { index: sceneIndex + 1 })}
      data-testid="cinema-screen"
    >
      <div className="min-h-0 flex-1">
        {state === 'playable' && playableUrl && mediaKind === 'image' ? (
          <img
            key={`${playableUrl}-${reloadToken}`}
            src={playableUrl}
            alt={t('studio.cinema.screenResultAlt', { index: sceneIndex + 1 })}
            className="h-full w-full object-contain"
            onError={() => setPlaybackFailed(true)}
          />
        ) : null}

        {state === 'playable' && playableUrl && mediaKind !== 'image' ? (
          <video
            key={`${playableUrl}-${reloadToken}`}
            src={playableUrl}
            controls
            playsInline
            preload="metadata"
            className="h-full w-full bg-black"
            onError={() => setPlaybackFailed(true)}
          />
        ) : null}

        {state === 'empty' ? placeholder('studio.cinema.screenEmptyTitle', 'studio.cinema.screenEmptyHint') : null}
        {state === 'rendering'
          ? placeholder('studio.cinema.screenRenderingTitle', 'studio.cinema.screenRenderingHint')
          : null}
        {state === 'failed' ? placeholder('studio.cinema.screenFailedTitle', 'studio.cinema.screenFailedHint') : null}
        {state === 'media_gap'
          ? placeholder('studio.cinema.screenMediaGapTitle', 'studio.cinema.screenMediaGapHint')
          : null}
      </div>

      {playbackFailed && state === 'playable' ? (
        <div className="absolute inset-x-0 bottom-0 flex items-center gap-2 bg-black/80 px-3 py-2">
          <p className="flex-1 text-[11px] text-white/85">{t('studio.cinema.screenPlaybackFailed')}</p>
          <button
            type="button"
            className="rounded-md border border-white/25 px-2 py-0.5 text-[11px] text-white/90"
            onClick={() => {
              setPlaybackFailed(false)
              setReloadToken((token) => token + 1)
            }}
          >
            {t('studio.cinema.screenRetryPlayback')}
          </button>
          <button
            type="button"
            className="rounded-md border border-white/25 px-2 py-0.5 text-[11px] text-white/90"
            onClick={onReconcile}
          >
            {t('studio.cinema.reconcile')}
          </button>
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-2 px-3 py-1.5">
        {hasNewerWorkBehindResult ? (
          <span className="rounded-full bg-white/10 px-2 py-0.5 text-[10px] text-white/80">
            {t('studio.cinema.screenNewerWorkBehind')}
          </span>
        ) : null}
        {activeRenderStatusKey ? (
          <span className="rounded-full bg-white/10 px-2 py-0.5 text-[10px] text-white/80">
            {t(activeRenderStatusKey)}
          </span>
        ) : null}
        {state === 'failed' || state === 'media_gap' ? (
          <button
            type="button"
            className="rounded-full border border-white/25 px-2 py-0.5 text-[10px] text-white/85"
            onClick={onReconcile}
          >
            {t('studio.cinema.reconcile')}
          </button>
        ) : null}
        {refreshPausedReasonKey ? (
          <>
            <span className="text-[10px] text-white/70">{t(refreshPausedReasonKey)}</span>
            <button
              type="button"
              className="rounded-full border border-white/25 px-2 py-0.5 text-[10px] text-white/85"
              onClick={onResumeRefresh}
            >
              {t('studio.cinema.renderRefreshResume')}
            </button>
          </>
        ) : null}
      </div>
    </section>
  )
}
