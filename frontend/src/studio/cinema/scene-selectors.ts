import type {
  StudioRenderStatus,
  StudioSceneAttachment,
  StudioSceneMessage,
  StudioSceneRender,
  StudioSceneRun,
  StudioTokenUsage,
} from '../protocol/studio-agent-types'
import {
  buildStudioCinemaSceneKey,
  isStudioCinemaActiveRenderStatus,
  isStudioCinemaActiveRunStatus,
  isStudioCinemaTerminalRenderStatus,
  type StudioCinemaFeedback,
  type StudioCinemaRenderRefreshState,
  type StudioCinemaSceneIdentity,
  type StudioCinemaSceneState,
  type StudioCinemaState,
  type StudioCinemaStreamState,
} from './types'

/**
 * Read models for the Cinema UI.
 *
 * Selectors are pure and derived: they never mutate state, never read a clock and never invent a
 * status. Three product rules live here. First, submission capability is one shared rule that the
 * controller enforces and the UI renders, so a button can never offer an action the controller would
 * refuse. Second, media is chosen by asking every successful render for a browser-loadable locator
 * and then taking the newest one that has it, so a newer result without playable media cannot hide
 * an older video. Third, a workspace-relative attachment path is not a browser URL, so it is never
 * turned into a `src`: the view reports the capability gap and keeps the placeholder instead.
 */

/** Bound for a plain `http(s)` URL: it is a locator, not a payload. */
export const STUDIO_CINEMA_MEDIA_URL_MAX_LENGTH = 2048

/**
 * The only same-origin media directories a Scene render may point at, keyed by directory then by the
 * lowercase extension. This is the frontend mirror of the backend `readStudioPublicMediaLocator`
 * table: `/videos/<jobId>.mp4` and `/images/<jobId>-<index>.png` are the verified production
 * outputs, and an extension missing here is refused instead of being guessed.
 */
export const STUDIO_CINEMA_SAME_ORIGIN_MEDIA: Readonly<
  Record<string, Readonly<Record<string, StudioCinemaMediaKind>>>
> = {
  videos: { mp4: 'video' },
  images: { png: 'image' },
}

const STUDIO_CINEMA_SAME_ORIGIN_FILENAME_PATTERN = /^[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?$/

/**
 * Bound for a `data:` locator, which carries the media itself. A plot PNG or a short clip is far
 * larger than a URL, so this is deliberately not the URL bound; it only keeps a single frame from
 * being arbitrarily large.
 */
export const STUDIO_CINEMA_MEDIA_DATA_URI_MAX_LENGTH = 16 * 1024 * 1024

export interface StudioCinemaSceneIndexEntry {
  id: string
  position: number
  isSelected: boolean
  isBusy: boolean
  snapshotStatus: StudioCinemaSceneState['snapshotStatus']
  streamState: StudioCinemaStreamState
  hasFailedOutcome: boolean
  needsReconciliation: boolean
}

export interface StudioCinemaUserStatus {
  /** Stable code for i18n; the UI never receives internal error text or a server path. */
  code: string
  /**
   * `connection` is deliberately separate: a dropped stream or a resync is a transport fact, never a
   * failed Run, so the UI can show a reconnect hint without rewriting the Scene outcome.
   */
  kind: 'idle' | 'working' | 'failed' | 'recoverable' | 'connection'
}

export type StudioCinemaMediaKind = 'video' | 'image'

export interface StudioCinemaDisplayRender {
  /** Render whose media is on screen: the newest successful Render that has a playable locator. */
  render: StudioSceneRender | null
  media: StudioSceneAttachment | null
  mediaKind: StudioCinemaMediaKind | null
  /** Present only for a real browser locator (`data:` / `http(s):`); never a workspace path. */
  playableUrl: string | null
  /** Newest Render of the Scene in any status, for the working badge beside the media. */
  latest: StudioSceneRender | null
  latestStatus: StudioRenderStatus | null
  /** Newest successful Render, whether or not it has playable media. */
  newestSuccess: StudioSceneRender | null
  /**
   * True when the newest successful Render carries attachments but no successful Render has a
   * playable locator: the placeholder stays and 11C2 must report the capability gap.
   */
  capabilityGap: boolean
}

export interface StudioCinemaSceneView {
  identity: StudioCinemaSceneIdentity
  messages: StudioSceneMessage[]
  draft: string
  submitting: boolean
  canSubmit: boolean
  /**
   * Why a submit is refused, from the same single rule the controller enforces, so the composer can
   * show a stable local reason without duplicating the eligibility logic.
   */
  submitBlockReason: StudioCinemaSubmitBlockReason | null
  canCancel: boolean
  canReconcile: boolean
  needsReconciliation: boolean
  latestRun: StudioSceneRun | null
  activeRun: StudioSceneRun | null
  tokenUsage: StudioTokenUsage | null
  display: StudioCinemaDisplayRender
  feedback: StudioCinemaFeedback | null
  userStatus: StudioCinemaUserStatus
  snapshotStatus: StudioCinemaSceneState['snapshotStatus']
  streamState: StudioCinemaStreamState
  /** Set when a recovery window could not be proven complete and a checkpoint read is due. */
  convergencePending: boolean
  /** Set when recovery finished by re-reading the snapshot instead of replaying every frame. */
  resyncedAt: number | null
  /** The Manim render of this Scene that has not finished yet, or `null` when there is none. */
  activeRender: StudioSceneRender | null
  /**
   * Automatic refresh bookkeeping. `paused` is a statement about the loop (bounded failures or
   * budget), never a claim that the render failed, and the UI offers a manual resume for it.
   */
  renderRefresh: StudioCinemaRenderRefreshState
  sceneOrderIndex: number
}

/**
 * The Manim render of this Scene that is still `queued` or `running`, or `null`. This is the only
 * condition that keeps the bounded refresh loop alive: the Agent Run finishing says nothing about
 * the render, so the loop follows the render, never the Run.
 */
/**
 * Ids of every unfinished Manim render of this Scene, sorted. This is the scene's *wait set*: a
 * refresh cycle waits for the whole set, so a render joining it (a newly created render) or the last
 * one leaving it (the wait is over) is a different wait with its own budget. A status change of the
 * same render is not, which is what keeps the budget meaningful for one stuck render.
 */
export function readStudioCinemaActiveRenderIds(scene: StudioCinemaSceneState): string[] {
  return scene.renders
    .filter((render) => render.kind === 'manim' && isStudioCinemaActiveRenderStatus(render.status))
    .map((render) => render.id)
    .sort()
}

/** The wait target of a refresh cycle: a stable, deterministic signature of the Scene's wait set. */
export function readStudioCinemaRenderWaitTarget(scene: StudioCinemaSceneState): string {
  return readStudioCinemaActiveRenderIds(scene).join(',')
}

export function readStudioCinemaActiveRender(scene: StudioCinemaSceneState): StudioSceneRender | null {
  return (
    scene.renders.find(
      (render) => render.kind === 'manim' && isStudioCinemaActiveRenderStatus(render.status),
    ) ?? null
  )
}

/**
 * Why a submit is refused. Shared by the controller (which enforces it) and the view (which renders
 * it), so the composer can never offer a submit the controller would reject.
 */
export type StudioCinemaSubmitBlockReason =
  | 'loading'
  | 'snapshot_failed'
  | 'empty_draft'
  | 'submitting'
  | 'active_run'
  | 'reconciliation'

export interface StudioCinemaSceneEligibility {
  canSubmit: boolean
  submitBlockReason: StudioCinemaSubmitBlockReason | null
  /** Cancel is offered only while an active Run of this Scene is known and no cancel is pending. */
  canCancel: boolean
  canReconcile: boolean
}

export function selectStudioCinemaSceneIndex(state: StudioCinemaState): StudioCinemaSceneIndexEntry[] {
  return state.sceneOrder.map((sceneId, position) => {
    const record = state.scenes[buildStudioCinemaSceneKey({ sessionId: state.session.id ?? '', sceneId })]
    return {
      id: sceneId,
      position,
      isSelected: state.selectedSceneId === sceneId,
      isBusy: record ? isSceneRecordBusy(record) : false,
      snapshotStatus: record?.snapshotStatus ?? 'idle',
      streamState: record?.streamState ?? 'idle',
      hasFailedOutcome: record ? hasSceneFailedOutcome(record) : false,
      needsReconciliation: record?.needsReconciliation ?? false,
    }
  })
}

export function selectStudioCinemaSelectedSceneView(state: StudioCinemaState): StudioCinemaSceneView | null {
  return state.selectedSceneId ? selectStudioCinemaSceneView(state, state.selectedSceneId) : null
}

export function selectStudioCinemaSceneView(
  state: StudioCinemaState,
  sceneId: string,
): StudioCinemaSceneView | null {
  const sessionId = state.session.id
  if (!sessionId) {
    return null
  }

  const key = buildStudioCinemaSceneKey({ sessionId, sceneId })
  const record = state.scenes[key]
  if (!record) {
    return null
  }

  const latestRun = selectStudioCinemaLatestRun(record)
  const activeRun = readStudioCinemaActiveRun(record)
  const eligibility = readStudioCinemaSceneEligibility(record)
  const display = selectStudioCinemaDisplayRender(record)

  return {
    identity: record.identity,
    messages: record.messages,
    draft: record.draft,
    submitting: record.submitting,
    canSubmit: eligibility.canSubmit,
    submitBlockReason: eligibility.submitBlockReason,
    canCancel: eligibility.canCancel,
    canReconcile: eligibility.canReconcile,
    needsReconciliation: record.needsReconciliation,
    latestRun,
    activeRun,
    tokenUsage: latestRun?.tokenUsage ?? null,
    display,
    feedback: record.feedback,
    userStatus: selectStudioCinemaUserStatus(record),
    snapshotStatus: record.snapshotStatus,
    streamState: record.streamState,
    convergencePending: record.convergencePending,
    resyncedAt: record.resyncedAt,
    activeRender: readStudioCinemaActiveRender(record),
    renderRefresh: record.renderRefresh,
    sceneOrderIndex: state.sceneOrder.indexOf(sceneId),
  }
}

/**
 * One submit/cancel/reconcile rule, used by both the controller and the view. A submit requires an
 * authoritative snapshot of the Scene (so the absence of an active Run is proven rather than
 * assumed), an empty-free draft, no run in flight and no outcome still waiting for reconciliation.
 */
export function readStudioCinemaSceneEligibility(
  scene: StudioCinemaSceneState,
): StudioCinemaSceneEligibility {
  const activeRun = readStudioCinemaActiveRun(scene)
  const canReconcile = scene.needsReconciliation || scene.snapshotStatus === 'error' || scene.convergencePending

  let submitBlockReason: StudioCinemaSubmitBlockReason | null = null
  if (scene.snapshotStatus === 'loading' || scene.snapshotStatus === 'idle') {
    submitBlockReason = 'loading'
  } else if (scene.snapshotStatus === 'error') {
    submitBlockReason = 'snapshot_failed'
  } else if (scene.submitting) {
    submitBlockReason = 'submitting'
  } else if (activeRun) {
    submitBlockReason = 'active_run'
  } else if (scene.needsReconciliation) {
    submitBlockReason = 'reconciliation'
  } else if (!scene.draft.trim()) {
    submitBlockReason = 'empty_draft'
  }

  return {
    canSubmit: submitBlockReason === null,
    submitBlockReason,
    canCancel: !scene.cancelRequested && activeRun !== null,
    canReconcile,
  }
}

/** Newest Run of one Scene; ties fall back to insertion order, never to a random key. */
export function selectStudioCinemaLatestRun(scene: StudioCinemaSceneState): StudioSceneRun | null {
  let latest: StudioSceneRun | null = null
  for (const run of scene.runs) {
    if (!latest || isLaterRun(run, latest)) {
      latest = run
    }
  }
  return latest
}

/**
 * Active Run of one Scene, derived from the public Run records rather than from a second stored id:
 * a restored or server-updated Run is therefore cancelable immediately, and a Run that reached a
 * terminal status can never be cancelled again. Pending and running are the active statuses.
 */
export function readStudioCinemaActiveRun(scene: StudioCinemaSceneState): StudioSceneRun | null {
  let active: StudioSceneRun | null = null
  for (const run of scene.runs) {
    if (!isStudioCinemaActiveRunStatus(run.status)) {
      continue
    }
    if (!active || isLaterRun(run, active)) {
      active = run
    }
  }
  return active
}

export function selectStudioCinemaLatestRender(scene: StudioCinemaSceneState): StudioSceneRender | null {
  let latest: StudioSceneRender | null = null
  for (const render of scene.renders) {
    if (!latest || isLaterRender(render, latest)) {
      latest = render
    }
  }
  return latest
}

/**
 * Display policy. Every successful Render is asked for a playable locator first, and the newest one
 * that has it is displayed; the newest Render in any status and the newest successful Render are
 * reported separately. A newer Render that is running, failed, or successful without playable media
 * therefore never replaces a video that is already on screen, and only a Scene with no playable
 * media at all reports the capability gap (keeping the placeholder).
 */
export function selectStudioCinemaDisplayRender(scene: StudioCinemaSceneState): StudioCinemaDisplayRender {
  const latest = selectStudioCinemaLatestRender(scene)

  let newestSuccess: StudioSceneRender | null = null
  let displayed: StudioSceneRender | null = null
  let displayedMedia: StudioCinemaPlayableMedia | null = null

  for (const render of scene.renders) {
    if (render.status !== 'completed') {
      continue
    }
    if (!newestSuccess || isLaterRender(render, newestSuccess)) {
      newestSuccess = render
    }

    const media = readStudioCinemaPlayableMedia(render.attachments)
    if (media && (!displayed || isLaterRender(render, displayed))) {
      displayed = render
      displayedMedia = media
    }
  }

  return {
    render: displayed,
    media: displayedMedia?.attachment ?? null,
    mediaKind: displayedMedia?.kind ?? null,
    playableUrl: displayedMedia?.url ?? null,
    latest,
    latestStatus: latest?.status ?? null,
    newestSuccess,
    capabilityGap:
      displayed === null && newestSuccess !== null && Boolean(newestSuccess.attachments?.length),
  }
}

export interface StudioCinemaPlayableMedia {
  attachment: StudioSceneAttachment
  kind: StudioCinemaMediaKind
  url: string
}

/**
 * One attachment of a Render, in the order the server sent them, that a browser can load directly.
 * A relative workspace path, an absolute path or an unsupported media type answers `null`, so the
 * caller keeps the placeholder instead of guessing a URL (and never builds a server path).
 */
export function readStudioCinemaPlayableMedia(
  attachments: readonly StudioSceneAttachment[] | undefined,
): StudioCinemaPlayableMedia | null {
  if (!attachments?.length) {
    return null
  }

  for (const attachment of attachments) {
    const locator = readStudioCinemaMediaLocator(attachment)
    if (locator) {
      return locator
    }
  }

  return null
}

/**
 * One attachment as a browser-loadable locator. A `data:` URI and an `http(s)` URL are validated by
 * two separate rules — they carry completely different things — and the media kind comes from the
 * locator itself (the MIME inside a data URI is authoritative), never from an unchecked claim.
 */
export function readStudioCinemaMediaLocator(
  attachment: StudioSceneAttachment,
): StudioCinemaPlayableMedia | null {
  const path = typeof attachment.path === 'string' ? attachment.path.trim() : ''
  if (!path || path.length > STUDIO_CINEMA_MEDIA_DATA_URI_MAX_LENGTH) {
    return null
  }

  const dataUri = readStudioCinemaDataUri(path)
  if (dataUri) {
    const kind = readStudioCinemaMimeMediaKind(dataUri.mimeType)
    return kind ? { attachment, kind, url: path } : null
  }

  const sameOrigin = readStudioCinemaSameOriginMediaLocator(path)
  if (sameOrigin) {
    return { attachment, kind: sameOrigin.kind, url: sameOrigin.url }
  }

  const url = readStudioCinemaHttpMediaUrl(path)
  if (!url) {
    return null
  }
  const kind = readStudioCinemaMediaKind(attachment, url)
  return kind ? { attachment, kind, url } : null
}

/**
 * Same-origin public media, mirroring the backend rule exactly: `/videos/<filename>` or
 * `/images/<filename>` and nothing else — one filename segment from the table's directory, no
 * percent encoding, no query, no fragment, no backslash, no duplicate slash, no `..`, lowercase
 * extension. The directory/extension table decides the media kind, so a mismatched `mimeType` claim
 * cannot promote or demote it.
 */
export function readStudioCinemaSameOriginMediaLocator(
  path: string,
): { url: string; kind: StudioCinemaMediaKind } | null {
  if (!path.startsWith('/') || path.length > STUDIO_CINEMA_MEDIA_URL_MAX_LENGTH) {
    return null
  }
  if (/[\\%?#]/.test(path) || /[\u0000-\u001f\u007f\s]/.test(path)) {
    return null
  }

  const segments = path.split('/')
  if (segments.length !== 3 || segments[0] !== '') {
    return null
  }

  const table = STUDIO_CINEMA_SAME_ORIGIN_MEDIA[segments[1] ?? '']
  const filename = segments[2] ?? ''
  if (!table || !STUDIO_CINEMA_SAME_ORIGIN_FILENAME_PATTERN.test(filename) || filename.includes('..')) {
    return null
  }

  const extensionIndex = filename.lastIndexOf('.')
  const extension = extensionIndex > 0 ? filename.slice(extensionIndex + 1) : ''
  if (!extension || extension !== extension.toLowerCase()) {
    return null
  }
  const kind = table[extension]
  return kind ? { url: path, kind } : null
}

export interface StudioCinemaDataUri {
  mimeType: string
  base64: boolean
  payload: string
}

/**
 * Parsed `data:` locator, or `null` when it is not one, has no media MIME, carries no payload, is
 * longer than the media payload bound, or carries whitespace/control characters that would break a
 * `src`. The URL bound deliberately does not apply here: a data URI is a payload.
 */
export function readStudioCinemaDataUri(path: string): StudioCinemaDataUri | null {
  if (!/^data:/i.test(path) || path.length > STUDIO_CINEMA_MEDIA_DATA_URI_MAX_LENGTH) {
    return null
  }

  const commaIndex = path.indexOf(',')
  if (commaIndex < 0) {
    return null
  }

  const headerParts = path.slice(5, commaIndex).split(';')
  const mimeType = (headerParts[0] ?? '').trim().toLowerCase()
  const payload = path.slice(commaIndex + 1)
  if (!/^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/.test(mimeType)) {
    return null
  }
  // P2: a valid `type/subtype` is not enough — only the image/video categories the cinema can
  // display are media. `text/plain`, `text/html`, `application/*` and `audio/*` are refused here
  // (the caller's `readStudioCinemaMimeMediaKind` gate was the only place that tried to).
  if (!readStudioCinemaMimeMediaKind(mimeType)) {
    return null
  }
  if (!payload || /[\u0000-\u001f\u007f\s]/.test(payload)) {
    return null
  }

  return {
    mimeType,
    base64: headerParts.slice(1).some((part) => part.trim().toLowerCase() === 'base64'),
    payload,
  }
}

/**
 * Browser-loadable URL only: `http(s)` within the URL bound, without whitespace or control
 * characters. A workspace path, an absolute filesystem path or a server path is never one.
 */
export function readStudioCinemaHttpMediaUrl(path: string): string | null {
  if (path.length > STUDIO_CINEMA_MEDIA_URL_MAX_LENGTH) {
    return null
  }
  if (/[\u0000-\u001f\u007f\s]/.test(path)) {
    return null
  }
  if (!/^https?:\/\//i.test(path)) {
    return null
  }
  return path
}

/**
 * Media kind of one attachment. For a `data:` locator the MIME inside the URI decides — an
 * attachment that claims another type cannot promote or demote it. For an `http(s)` locator the
 * declared MIME is used when it is a media type, with the path extension as the fallback, because a
 * generic `application/octet-stream` is common; a locator with neither signal is refused rather than
 * passed to the browser as an unknown media type.
 */
export function readStudioCinemaMediaKind(
  attachment: StudioSceneAttachment,
  url?: string,
): StudioCinemaMediaKind | null {
  const locator = url ?? attachment.path
  const dataUri = readStudioCinemaDataUri(locator)
  if (dataUri) {
    return readStudioCinemaMimeMediaKind(dataUri.mimeType)
  }

  const sameOrigin = readStudioCinemaSameOriginMediaLocator(locator)
  if (sameOrigin) {
    return sameOrigin.kind
  }

  const declared = readStudioCinemaMimeMediaKind(attachment.mimeType?.toLowerCase() ?? '')
  if (declared) {
    return declared
  }
  return readStudioCinemaPathMediaKind(locator)
}

function readStudioCinemaMimeMediaKind(mimeType: string): StudioCinemaMediaKind | null {
  if (mimeType.startsWith('video/')) {
    return 'video'
  }
  if (mimeType.startsWith('image/')) {
    return 'image'
  }
  return null
}

function readStudioCinemaPathMediaKind(path: string): StudioCinemaMediaKind | null {
  const withoutQuery = path.split(/[?#]/)[0]?.toLowerCase() ?? ''
  if (/\.(mp4|webm|mov|m4v)$/.test(withoutQuery)) {
    return 'video'
  }
  if (/\.(png|jpg|jpeg|gif|webp|avif)$/.test(withoutQuery)) {
    return 'image'
  }
  return null
}

/**
 * Safe user status. Connection problems, a loading Scene and a missing browser locator are reported
 * separately (stream state, snapshot status and `capabilityGap`), so this selector never converts a
 * disconnected stream into a failed Run, and never surfaces an internal error message.
 */
export function selectStudioCinemaUserStatus(scene: StudioCinemaSceneState): StudioCinemaUserStatus {
  if (scene.needsReconciliation) {
    return { code: 'run_submit_unknown', kind: 'recoverable' }
  }

  if (scene.snapshotStatus === 'error') {
    return { code: 'snapshot_failed', kind: 'recoverable' }
  }

  const latestRun = selectStudioCinemaLatestRun(scene)
  const activeRun = readStudioCinemaActiveRun(scene)
  const latestRender = selectStudioCinemaLatestRender(scene)

  if (scene.submitting) {
    return { code: 'run_submitting', kind: 'working' }
  }
  if (activeRun) {
    return { code: 'run_running', kind: 'working' }
  }
  if (latestRender && !isStudioCinemaTerminalRenderStatus(latestRender.status)) {
    return { code: 'render_running', kind: 'working' }
  }
  if (scene.snapshotStatus === 'loading') {
    return { code: 'scene_loading', kind: 'working' }
  }
  if (scene.convergencePending) {
    return { code: 'stream_resync', kind: 'connection' }
  }
  if (scene.feedback) {
    if (scene.feedback.code === 'stream_disconnected' || scene.feedback.code === 'stream_resync') {
      return { code: scene.feedback.code, kind: 'connection' }
    }
    return { code: scene.feedback.code, kind: scene.feedback.needsReconciliation ? 'recoverable' : 'failed' }
  }
  if (latestRun && (latestRun.status === 'failed' || latestRun.status === 'cancelled')) {
    return { code: `run_${latestRun.status}`, kind: 'failed' }
  }
  if (latestRender && latestRender.status === 'failed') {
    return { code: 'render_failed', kind: 'failed' }
  }
  // A dropped stream is reported as a transport fact, not as an outcome: the Scene keeps whatever
  // status it had, and the UI can offer a reconnect without rewriting the record.
  if (scene.streamState === 'disconnected') {
    return { code: 'stream_disconnected', kind: 'connection' }
  }

  return { code: 'idle', kind: 'idle' }
}

function isSceneRecordBusy(scene: StudioCinemaSceneState): boolean {
  if (scene.submitting) {
    return true
  }
  if (readStudioCinemaActiveRun(scene)) {
    return true
  }
  const latestRender = selectStudioCinemaLatestRender(scene)
  return Boolean(latestRender && !isStudioCinemaTerminalRenderStatus(latestRender.status))
}

function hasSceneFailedOutcome(scene: StudioCinemaSceneState): boolean {
  const latestRun = selectStudioCinemaLatestRun(scene)
  if (latestRun && (latestRun.status === 'failed' || latestRun.status === 'cancelled')) {
    return true
  }
  const latestRender = selectStudioCinemaLatestRender(scene)
  return latestRender?.status === 'failed'
}

function isLaterRun(candidate: StudioSceneRun, current: StudioSceneRun): boolean {
  return candidate.createdAt === current.createdAt
    ? true
    : candidate.createdAt > current.createdAt
}

function isLaterRender(candidate: StudioSceneRender, current: StudioSceneRender): boolean {
  if (candidate.updatedAt !== current.updatedAt) {
    return candidate.updatedAt > current.updatedAt
  }
  return candidate.createdAt >= current.createdAt
}
