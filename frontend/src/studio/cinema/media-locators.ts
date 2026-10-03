/**
 * Browser-loadable media locators for a Scene render.
 *
 * A render attachment is only playable when it resolves to a `data:` URI, a same-origin `/videos|/images`
 * path, or an `http(s)` URL -- never a raw workspace path. This module owns the parsing rules and the
 * media-kind resolution; the selectors keep the scene-level display logic that calls into it.
 */
import type { StudioSceneAttachment } from '../protocol/studio-agent-types'

export type StudioCinemaMediaKind = 'video' | 'image'

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