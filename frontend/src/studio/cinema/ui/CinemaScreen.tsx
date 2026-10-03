import { useEffect, useState, type ReactNode } from 'react'
import type { TranslationKey } from '../../../i18n/messages'
import { useI18n } from '../../../i18n'
import ManimCatLogo from '../../../components/ManimCatLogo'
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

  // Every placeholder sits on the dark stage, so it uses light ink instead of the theme's text tokens
  // (which are near-black in the light theme and would be unreadable on `#101415`).
  const placeholder = (titleKey: TranslationKey, hintKey: TranslationKey, art?: ReactNode) => (
    <div className="flex h-full flex-col items-center justify-center gap-3 px-4 text-center">
      {art}
      <p className="text-base text-white/85">{t(titleKey)}</p>
      <p className="max-w-md text-sm text-white/55">{t(hintKey)}</p>
    </div>
  )

  return (
    <section
      className="relative flex h-full min-h-0 flex-col overflow-hidden rounded-2xl bg-[#101415]"
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

        {state === 'empty'
          ? placeholder(
              'studio.cinema.screenEmptyTitle',
              'studio.cinema.screenEmptyHint',
              // The project's artistic M, as a faint watermark on the empty stage.
              <ManimCatLogo glyph className="h-24 w-24 text-white/25" />,
            )
          : null}
        {state === 'rendering'
          ? placeholder('studio.cinema.screenRenderingTitle', 'studio.cinema.screenRenderingHint')
          : null}
        {state === 'failed' ? placeholder('studio.cinema.screenFailedTitle', 'studio.cinema.screenFailedHint') : null}
        {state === 'media_gap'
          ? placeholder('studio.cinema.screenMediaGapTitle', 'studio.cinema.screenMediaGapHint')
          : null}
      </div>

      {playbackFailed && state === 'playable' ? (
        <div className="absolute inset-x-0 bottom-0 flex flex-wrap items-center gap-2 bg-black/80 px-3 py-2">
          <p className="flex-1 text-sm text-white/90">{t('studio.cinema.screenPlaybackFailed')}</p>
          <button
            type="button"
            className="inline-flex min-h-[36px] items-center rounded-md bg-white/10 px-2.5 text-sm text-white/90 transition-colors hover:bg-white/20"
            onClick={() => {
              setPlaybackFailed(false)
              setReloadToken((token) => token + 1)
            }}
          >
            {t('studio.cinema.screenRetryPlayback')}
          </button>
          <button
            type="button"
            className="inline-flex min-h-[36px] items-center rounded-md bg-white/10 px-2.5 text-sm text-white/90 transition-colors hover:bg-white/20"
            onClick={onReconcile}
          >
            {t('studio.cinema.reconcile')}
          </button>
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-2 px-3 py-1.5">
        {hasNewerWorkBehindResult ? (
          <span className="rounded-full bg-white/10 px-2 py-0.5 text-sm text-white/85">
            {t('studio.cinema.screenNewerWorkBehind')}
          </span>
        ) : null}
        {activeRenderStatusKey ? (
          <span className="rounded-full bg-white/10 px-2 py-0.5 text-sm text-white/85">
            {t(activeRenderStatusKey)}
          </span>
        ) : null}
        {state === 'failed' || state === 'media_gap' ? (
          <button
            type="button"
            className="inline-flex min-h-[36px] items-center rounded-full bg-white/10 px-2.5 text-sm text-white/90 transition-colors hover:bg-white/20"
            onClick={onReconcile}
          >
            {t('studio.cinema.reconcile')}
          </button>
        ) : null}
        {refreshPausedReasonKey ? (
          <>
            <span className="text-sm text-white/80">{t(refreshPausedReasonKey)}</span>
            <button
              type="button"
              className="inline-flex min-h-[36px] items-center rounded-full bg-white/10 px-2.5 text-sm text-white/90 transition-colors hover:bg-white/20"
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
