import { useLayoutEffect, useState, type ReactNode } from 'react'
import type { TranslationKey } from '../../../i18n/messages'
import { useI18n } from '../../../i18n'
import ManimCatLogo from '../../../components/ManimCatLogo'
import type { StudioCinemaScreenState } from './cinema-labels'
import type { StudioKind } from '../../protocol/studio-agent-types'
import { cinemaUnitKey } from './cinema-copy'

/**
 * The video screen (task 11C2).
 *
 * It renders one thing: the Scene's public playable locator. It never builds an `src` from metadata,
 * `sourcePath` or an attachment path, and a playback problem is reported as a playback problem — the
 * Render keeps whatever status the server gave it.
 *
 * Two surfaces, one slot. While there is no result the slot is the dark stage a cinema screen is
 * expected to be (placeholders and status chips use light ink). Once an image or a video exists the
 * dark stage is gone and the media is shown on the page at its own aspect ratio — a hairline and a
 * faint all-round shadow, never a dropped one: anything soft under the result reads as a blur.
 *
 * The screen fills its slot in both cases (`h-full w-full`) and never sizes itself from the media: a
 * media element that has just re-mounted has no intrinsic size for a frame, and a surface that shrinks
 * to fit it collapses into a narrow dark strip (the portrait-shaped black rectangle) before the real
 * size arrives.
 */

export interface CinemaScreenProps {
  state: StudioCinemaScreenState
  studioKind: StudioKind
  sceneIndex: number
  playableUrl: string | null
  mediaKind: 'video' | 'image' | null
  /** True when a newer render is still running behind an already playable result. */
  hasNewerWorkBehindResult: boolean
  refreshPausedReasonKey: TranslationKey | null
  onResumeRefresh: () => void
  onReconcile: () => void
}

/**
 * The result keeps its own aspect ratio inside the slot. A hairline and a whisper of an all-round
 * shadow let it read as its own object on the page without the soft dark halo a dropped shadow makes.
 */
const MEDIA_BASE_CLASS =
  'max-h-full max-w-full rounded-lg object-contain ring-1 ring-black/5 shadow-[0_0_12px_rgba(0,0,0,0.06)] dark:ring-white/10 dark:shadow-none'

/**
 * A media element that has not received its data yet has no intrinsic size, and a replaced element with
 * no intrinsic size is laid out at the CSS default object size (300×150) — a small box, wearing the
 * hairline above, that the metadata then snaps to the real aspect ratio. That snap is the "the video
 * shrank, then jumped" of a switch, so the media stays unpainted until it has a size of its own: the
 * dark stage is what is on screen, and the first frame that shows is already at the right size.
 *
 * The entrance fade is attached at that same moment. A media element that mounts hidden must not spend
 * the fade while it is still hidden, or it appears without it — correct size, but no dissolve out of
 * the dark stage.
 */
const mediaClass = (mediaReady: boolean) =>
  `${MEDIA_BASE_CLASS}${mediaReady ? ' studio-media-in' : ' invisible'}`

export function CinemaScreen({
  state,
  studioKind,
  sceneIndex,
  playableUrl,
  mediaKind,
  hasNewerWorkBehindResult,
  refreshPausedReasonKey,
  onResumeRefresh,
  onReconcile,
}: CinemaScreenProps) {
  const { t } = useI18n()
  const [playbackFailed, setPlaybackFailed] = useState(false)
  const [reloadToken, setReloadToken] = useState(0)
  // Whether the media element mounted *right now* has painted. Nothing shorter than that is safe: a
  // card that re-mounts its media — the one that leaves, and the one that arrives — gets a brand new
  // `<img>`/`<video>`, and until that element has data it has no intrinsic size. A `<video>` then falls
  // back to the spec's 300×150, which is the tiny black box (on the page's near-white background) the
  // dark stage below exists to prevent. "The browser already holds this locator" is not the same claim,
  // and trusting it is what put that box on screen.
  const [mediaReady, setMediaReady] = useState(false)

  // A different locator is a different result: the failure and the readiness of the old one do not
  // carry over. Reset before the browser paints, or the first frame of the new media is trusted for a
  // readiness it does not have yet.
  useLayoutEffect(() => {
    setPlaybackFailed(false)
    setMediaReady(false)
  }, [playableUrl, reloadToken])

  // The dark stage exists while there is nothing on screen to look at — including the gap between a
  // locator existing and its pixels arriving. Every ink below follows that surface: light ink on the
  // dark stage, theme ink once the media sits on the page.
  const onDarkStage = state !== 'playable' || !mediaReady
  const chipInk = onDarkStage ? 'bg-white/10 text-white/85' : 'bg-bg-tertiary/50 text-text-secondary'
  const chipButtonInk = onDarkStage
    ? 'bg-white/10 text-white/90 hover:bg-white/20'
    : 'bg-bg-tertiary/60 text-text-secondary hover:bg-bg-tertiary'

  // Every placeholder sits on the dark stage, so it uses light ink instead of the theme's text tokens
  // (which are near-black in the light theme and would be unreadable on `#101415`).
  const placeholder = (titleKey: TranslationKey, hintKey: TranslationKey, art?: ReactNode) => (
    // Keyed by the state so a placeholder change fades in instead of swapping instantly.
    <div
      key={state}
      className="studio-placeholder-in flex h-full flex-col items-center justify-center gap-3 px-4 text-center"
    >
      {art}
      <p className="text-base text-white/85">{t(titleKey)}</p>
      <p className="max-w-md text-sm text-white/55">{t(hintKey)}</p>
    </div>
  )

  return (
    <section
      className={`relative flex h-full min-h-0 w-full flex-col overflow-hidden rounded-2xl transition-[background-color] duration-[420ms] ease-soft ${
        onDarkStage ? 'bg-[#101415]' : ''
      }`}
      aria-label={t(cinemaUnitKey(studioKind, 'screenLabel'), { index: sceneIndex + 1 })}
      data-testid="cinema-screen"
    >
      <div className="flex min-h-0 flex-1 items-center justify-center">
        {state === 'playable' && playableUrl && mediaKind === 'image' ? (
          <img
            key={`${playableUrl}-${reloadToken}`}
            src={playableUrl}
            alt={t(cinemaUnitKey(studioKind, 'screenResultAlt'), { index: sceneIndex + 1 })}
            className={mediaClass(mediaReady)}
            onLoad={() => setMediaReady(true)}
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
            className={`${mediaClass(mediaReady)} bg-black`}
            onLoadedMetadata={() => setMediaReady(true)}
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
          <p className="studio-rise-in flex-1 text-sm text-white/90">{t('studio.cinema.screenPlaybackFailed')}</p>
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
          <span className={`studio-pop-in rounded-full px-2 py-0.5 text-sm ${chipInk}`}>
            {t('studio.cinema.screenNewerWorkBehind')}
          </span>
        ) : null}
        {state === 'failed' || state === 'media_gap' ? (
          <button
            type="button"
            className={`inline-flex min-h-[36px] items-center rounded-full px-2.5 text-sm transition-colors ${chipButtonInk}`}
            onClick={onReconcile}
          >
            {t('studio.cinema.reconcile')}
          </button>
        ) : null}
        {refreshPausedReasonKey ? (
          <>
            <span className={`text-sm ${onDarkStage ? 'text-white/80' : 'text-text-secondary'}`}>
              {t(refreshPausedReasonKey)}
            </span>
            <button
              type="button"
              className={`inline-flex min-h-[36px] items-center rounded-full px-2.5 text-sm transition-colors ${chipButtonInk}`}
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
