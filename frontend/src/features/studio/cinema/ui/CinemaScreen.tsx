import { useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import type { TranslationKey } from '../../../../shared/i18n/messages'
import { useI18n } from '../../../../shared/i18n/index'
import ManimCatLogo from '../../../../shared/components/ManimCatLogo'
import type { StudioCinemaScreenState } from './cinema-labels'
import type { StudioKind } from '../../protocol/studio-agent-types'
import { cinemaUnitKey } from './cinema-copy'
import { useVideoActivity } from './use-video-activity'

/**
 * The video screen (task 11C2).
 *
 * It renders one thing: the Scene's public playable locator. It never builds an `src` from metadata,
 * `sourcePath` or an attachment path, and a playback problem is reported as a playback problem — the
 * Render keeps whatever status the server gave it.
 *
 * Two surfaces, one slot. While there is no result the slot is the stage. In the light themes that is the
 * studio's own field (`stage` — the page colour): no panel is put up for a wait, so the ink draws straight on
 * the room and there is no edge to look at; the screen itself only appears once there is something to show.
 * The dark theme is the exception — there the stage is `#101415`, the surface a screen is expected to be and
 * one an unlit page cannot supply, held apart from the dark page by a hairline. The loading clip is drawn with
 * alpha, so it carries only its ink and takes whatever surface it lands on; one clip per ink (dark ink for a
 * light stage, light ink for the dark one). Once an image or a video exists the stage is gone and the media is
 * shown on the page at its own aspect ratio — a hairline and a faint all-round shadow, never a dropped one:
 * anything soft under the result reads as a blur.
 *
 * The screen fills its slot in both cases (`h-full w-full`) and never sizes itself from the media: a
 * media element that has just re-mounted has no intrinsic size for a frame, and a surface that shrinks
 * to fit it collapses into a narrow strip (the portrait-shaped rectangle) before the real size arrives.
 */

export interface CinemaScreenProps {
  /** Only the selected, visible card owns playback. */
  active?: boolean
  state: StudioCinemaScreenState
  studioKind: StudioKind
  sceneIndex: number
  playableUrl: string | null
  fallbackVideoUrl?: string
  mediaKind: 'video' | 'image' | null
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
 * stage is what is on screen, and the first frame that shows is already at the right size.
 *
 * The entrance fade is attached at that same moment. A media element that mounts hidden must not spend
 * the fade while it is still hidden, or it appears without it — correct size, but no dissolve out of
 * the stage.
 */
const mediaClass = (mediaReady: boolean) =>
  `${MEDIA_BASE_CLASS}${mediaReady ? ' studio-media-in' : ' invisible'}`

/**
 * The waiting art: the project's own loading animation, rendered by Manim from the mark's Fourier
 * coefficients. It is a clip rather than a spinner because the thing the studio makes is a Manim
 * video — the wait is the one place the product can say what it is.
 *
 * The clip carries an alpha channel, so nothing of the surface it sits on is baked into it: a video
 * is a rectangle with its own colour, and a rectangle whose colour is a level off the surface shows
 * its own edge as a line. With alpha there is no colour to be off. One clip per ink (dark ink for the
 * light theme, light ink for the dark one), each usable on any surface the theme may paint.
 *
 * The mp4 is the fallback for a browser that cannot decode VP9's alpha layer: it carries the same
 * drawing with that surface's colour painted in, which is exactly what such a browser would show.
 * `aspect-video` reserves the box before metadata lands (a `<video>` with no intrinsic size is 300×150).
 */
const LOADING_ART_CLASS = 'aspect-video w-[min(56%,600px)]'

const LoadingClip = ({ ink, surface, active }: { ink: 'light' | 'dark'; surface: string; active: boolean }) => {
  const ref = useRef<HTMLVideoElement>(null)
  useVideoActivity(ref, active, ink)
  return (
  <video
    ref={ref}
    className={`${surface} ${LOADING_ART_CLASS}`}
    loop
    muted
    playsInline
    aria-hidden="true"
  >
    <source src={`/studio-loading-${ink}.webm`} type="video/webm" />
    <source src={`/studio-loading-${ink}.mp4`} type="video/mp4" />
  </video>
  )
}

const LoadingArt = ({ active }: { active: boolean }) => (
  <>
    <LoadingClip ink="light" surface="dark:hidden" active={active} />
    <LoadingClip ink="dark" surface="hidden dark:block" active={active} />
  </>
)

export function CinemaScreen({
  active = true,
  state,
  studioKind,
  sceneIndex,
  playableUrl,
  fallbackVideoUrl,
  mediaKind,
  refreshPausedReasonKey,
  onResumeRefresh,
  onReconcile,
}: CinemaScreenProps) {
  const { t } = useI18n()
  const [playbackFailed, setPlaybackFailed] = useState(false)
  const [reloadToken, setReloadToken] = useState(0)
  const [failedLocalUrl, setFailedLocalUrl] = useState<string | null>(null)
  const effectiveUrl = failedLocalUrl === playableUrl && fallbackVideoUrl ? fallbackVideoUrl : playableUrl
  const videoRef = useRef<HTMLVideoElement>(null)
  useVideoActivity(videoRef, active && state === 'playable' && mediaKind !== 'image', `${effectiveUrl}-${reloadToken}`)
  // Whether the media element mounted *right now* has painted. Nothing shorter than that is safe: a
  // card that re-mounts its media — the one that leaves, and the one that arrives — gets a brand new
  // `<img>`/`<video>`, and until that element has data it has no intrinsic size. A `<video>` then falls
  // back to the spec's 300×150 — a box on the paper that `mediaClass`'s `invisible` keeps off screen. "The browser already holds this locator" is not the same claim,
  // and trusting it is what put that box on screen.
  const [mediaReady, setMediaReady] = useState(false)

  // A different locator is a different result: the failure and the readiness of the old one do not
  // carry over. Reset before the browser paints, or the first frame of the new media is trusted for a
  // readiness it does not have yet.
  useLayoutEffect(() => {
    setPlaybackFailed(false)
    setMediaReady(false)
  }, [effectiveUrl, reloadToken])

  useLayoutEffect(() => {
    setFailedLocalUrl(null)
  }, [playableUrl, fallbackVideoUrl])

  // The stage is the panel white in the light theme and the dark surface in the dark one; it is up
  // while there is nothing on screen to look at — including the gap between a locator existing and its
  // pixels arriving. Each surface has its own ink, and the art and the words share it.
  const onStage = state !== 'playable' || !mediaReady
  const chipButtonInk = onStage
    ? 'bg-ink/10 text-ink hover:bg-ink/20 dark:bg-white/10 dark:text-white/90 dark:hover:bg-white/20'
    : 'bg-bg-tertiary/60 text-text-secondary hover:bg-bg-tertiary'

  // A placeholder draws in the ink of the surface it is on. `hintVisible = false` keeps the sentence
  // for screen readers only.
  const placeholder = (
    titleKey: TranslationKey,
    hintKey: TranslationKey,
    art?: ReactNode,
    hintVisible = true,
  ) => (
    // Keyed by the state so a placeholder change fades in instead of swapping instantly.
    <div
      key={state}
      className="studio-placeholder-in flex h-full flex-col items-center justify-center gap-3 px-4 text-center"
    >
      {art}
      <p className="text-base text-ink dark:text-white/85">{t(titleKey)}</p>
      <p className={hintVisible ? 'max-w-md text-sm text-ink/55 dark:text-white/55' : 'sr-only'}>
        {t(hintKey)}
      </p>
    </div>
  )

  return (
    <section
      className={`relative flex h-full min-h-0 w-full flex-col overflow-hidden rounded-2xl transition-[background-color] duration-[420ms] ease-soft ${
        onStage
          ? 'bg-stage dark:ring-1 dark:ring-white/10'
          : ''
      }`}
      aria-label={t(cinemaUnitKey(studioKind, 'screenLabel'), { index: sceneIndex + 1 })}
      data-testid="cinema-screen"
    >
      <div className="flex min-h-0 flex-1 items-center justify-center">
        {state === 'playable' && playableUrl && mediaKind === 'image' ? (
          <img
            key={`${effectiveUrl}-${reloadToken}`}
            src={effectiveUrl ?? undefined}
            alt={t(cinemaUnitKey(studioKind, 'screenResultAlt'), { index: sceneIndex + 1 })}
            className={mediaClass(mediaReady)}
            onLoad={() => setMediaReady(true)}
            onError={() => setPlaybackFailed(true)}
          />
        ) : null}

        {state === 'playable' && playableUrl && mediaKind !== 'image' ? (
          <video
            ref={videoRef}
            key={`${effectiveUrl}-${reloadToken}`}
            src={effectiveUrl ?? undefined}
            controls
            muted
            playsInline
            preload={active ? 'auto' : 'none'}
            className={`${mediaClass(mediaReady)} bg-black`}
            onLoadedMetadata={() => setMediaReady(true)}
            onError={() => {
              if (playableUrl?.startsWith('blob:') && fallbackVideoUrl && effectiveUrl !== fallbackVideoUrl) {
                setMediaReady(false)
                setFailedLocalUrl(playableUrl)
              } else {
                setPlaybackFailed(true)
              }
            }}
          />
        ) : null}

        {state === 'empty'
          ? placeholder(
              'studio.cinema.screenEmptyTitle',
              'studio.cinema.screenEmptyHint',
              // The project's artistic M, as a faint watermark on the empty stage.
              <ManimCatLogo glyph className="h-24 w-24 text-ink/25 dark:text-white/25" />,
            )
          : null}
        {state === 'rendering'
          ? placeholder(
              'studio.cinema.screenRenderingTitle',
              'studio.cinema.screenRenderingHint',
              <LoadingArt active={active} />,
              false,
            )
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
            <span className={`text-sm ${onStage ? 'text-ink/55 dark:text-white/80' : 'text-text-secondary'}`}>
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
