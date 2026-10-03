/**
 * Public media locator policy (task 11C1M).
 *
 * One pure rule decides which strings may leave the server as *media*: a `data:` URI, an `http(s)`
 * URL, or a same-origin path under a public media directory that the server really serves. It is
 * shared by the Render result adapter (which turns a Manim job result into public attachment
 * candidates) and by the Scene DTO projection, so both sides can never disagree.
 *
 * Deliberately not media: a workspace-relative path, an absolute filesystem path, a Windows drive
 * or UNC path, a protocol-relative URL, and any same-origin path that could escape its directory
 * (`..`, encoded traversal, duplicate slashes, query, fragment, backslash, whitespace).
 */

export type StudioPublicMediaKind = 'video' | 'image'

export type StudioPublicMediaLocatorKind = 'same-origin' | 'data' | 'http'

export interface StudioPublicMediaLocator {
  /** The locator exactly as given, ready to be used by a browser. */
  locator: string
  kind: StudioPublicMediaLocatorKind
  /** Known only when the locator itself states it (the table, the data MIME, or the URL extension). */
  mediaKind?: StudioPublicMediaKind
  /** Declared media type: always known for a same-origin locator and for a `data:` URI. */
  mimeType?: string
}

/** Bound for a locator that only names media: a URL, not a payload. */
export const STUDIO_PUBLIC_MEDIA_URL_MAX_LENGTH = 2048

/** Bound for a `data:` locator, which carries the media itself. */
export const STUDIO_PUBLIC_MEDIA_DATA_URI_MAX_LENGTH = 16 * 1024 * 1024

/**
 * The only same-origin media directories this policy allows, keyed by the directory name, then by
 * the lowercase extension. Both entries are the verified production outputs of the existing queue:
 * `/videos/<jobId>.mp4` (`queues/processors/steps/render-video.ts`) and
 * `/images/<jobId>-<index>.png` (`queues/processors/steps/render-images.ts`).
 *
 * A new output format is a new entry here, never a pattern: an extension this table does not name
 * is refused instead of being guessed into a media type.
 */
const STUDIO_SAME_ORIGIN_MEDIA_TABLE: Readonly<
  Record<string, Readonly<Record<string, { mimeType: string; mediaKind: StudioPublicMediaKind }>>>
> = {
  videos: { mp4: { mimeType: 'video/mp4', mediaKind: 'video' } },
  images: { png: { mimeType: 'image/png', mediaKind: 'image' } }
}

/** One path segment of a public media file: no dot-leading names, no `..`, no separators. */
const STUDIO_SAME_ORIGIN_FILENAME_PATTERN = /^[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?$/

/** Whitespace and control characters, which would break a `src` attribute or hide a second value. */
const STUDIO_LOCATOR_UNSAFE_CHARACTERS = /[\u0000-\u001f\u007f\s]/

/**
 * Reads a public media locator, or `null` when the value may not leave the server. Surrounding
 * whitespace is refused instead of trimmed, so `/videos/a.mp4 ` can never be normalized into a
 * valid locator here and stay invalid everywhere else.
 */
export function readStudioPublicMediaLocator(value: unknown): StudioPublicMediaLocator | null {
  if (typeof value !== 'string') {
    return null
  }
  if (!value || value !== value.trim() || value.includes('\0')) {
    return null
  }
  if (value.length > STUDIO_PUBLIC_MEDIA_DATA_URI_MAX_LENGTH) {
    return null
  }

  return (
    readStudioDataUriLocator(value) ??
    readStudioHttpLocator(value) ??
    readStudioSameOriginLocator(value)
  )
}

export function isStudioPublicMediaLocator(value: unknown): boolean {
  return readStudioPublicMediaLocator(value) !== null
}

/** `data:` carrying a media MIME and a non-empty payload. The MIME inside the URI is authoritative. */
function readStudioDataUriLocator(value: string): StudioPublicMediaLocator | null {
  if (!/^data:/i.test(value)) {
    return null
  }
  if (value.length > STUDIO_PUBLIC_MEDIA_DATA_URI_MAX_LENGTH) {
    return null
  }

  const commaIndex = value.indexOf(',')
  if (commaIndex < 0) {
    return null
  }

  const mimeType = (value.slice(5, commaIndex).split(';')[0] ?? '').trim().toLowerCase()
  const mediaKind = readStudioMediaKindFromMimeType(mimeType)
  if (!mediaKind) {
    return null
  }

  const payload = value.slice(commaIndex + 1)
  if (!payload || STUDIO_LOCATOR_UNSAFE_CHARACTERS.test(payload)) {
    return null
  }

  return { locator: value, kind: 'data', mediaKind, mimeType }
}

function readStudioHttpLocator(value: string): StudioPublicMediaLocator | null {
  if (!/^https?:\/\//i.test(value)) {
    return null
  }
  if (value.length > STUDIO_PUBLIC_MEDIA_URL_MAX_LENGTH) {
    return null
  }
  if (STUDIO_LOCATOR_UNSAFE_CHARACTERS.test(value)) {
    return null
  }

  const mediaKind = readStudioMediaKindFromExtension(readStudioUrlPathExtension(value))
  return { locator: value, kind: 'http', ...(mediaKind ? { mediaKind } : {}) }
}

/**
 * `/videos/<filename>` or `/images/<filename>`, and nothing else: exactly three slash-separated
 * parts with an empty first one, one filename segment from the table's directory, no percent
 * encoding at all, and a lowercase extension the table names.
 */
function readStudioSameOriginLocator(value: string): StudioPublicMediaLocator | null {
  if (!value.startsWith('/')) {
    return null
  }
  if (value.length > STUDIO_PUBLIC_MEDIA_URL_MAX_LENGTH) {
    return null
  }
  if (/[\\%?#]/.test(value) || STUDIO_LOCATOR_UNSAFE_CHARACTERS.test(value)) {
    return null
  }

  const segments = value.split('/')
  if (segments.length !== 3 || segments[0] !== '') {
    return null
  }

  const directory = segments[1] ?? ''
  const filename = segments[2] ?? ''
  const table = STUDIO_SAME_ORIGIN_MEDIA_TABLE[directory]
  if (!table) {
    return null
  }
  if (!STUDIO_SAME_ORIGIN_FILENAME_PATTERN.test(filename) || filename.includes('..')) {
    return null
  }

  const extension = readStudioRawExtension(filename)
  if (!extension || extension !== extension.toLowerCase()) {
    return null
  }
  const entry = table[extension]
  if (!entry) {
    return null
  }

  return {
    locator: value,
    kind: 'same-origin',
    mediaKind: entry.mediaKind,
    mimeType: entry.mimeType
  }
}

function readStudioMediaKindFromMimeType(mimeType: string): StudioPublicMediaKind | null {
  if (mimeType.startsWith('video/')) {
    return 'video'
  }
  if (mimeType.startsWith('image/')) {
    return 'image'
  }
  return null
}

function readStudioMediaKindFromExtension(extension: string | null): StudioPublicMediaKind | null {
  if (!extension) {
    return null
  }
  const normalized = extension.toLowerCase()
  if (normalized === 'mp4' || normalized === 'webm' || normalized === 'mov' || normalized === 'm4v') {
    return 'video'
  }
  if (normalized === 'png' || normalized === 'jpg' || normalized === 'jpeg' || normalized === 'gif' || normalized === 'webp') {
    return 'image'
  }
  return null
}

/** Extension of a bare filename, exactly as written (case preserved), or `null`. */
function readStudioRawExtension(filename: string): string | null {
  const index = filename.lastIndexOf('.')
  if (index <= 0 || index === filename.length - 1) {
    return null
  }
  return filename.slice(index + 1)
}

function readStudioUrlPathExtension(url: string): string | null {
  const withoutFragment = url.split('#')[0] ?? ''
  const withoutQuery = withoutFragment.split('?')[0] ?? ''
  const lastSegment = withoutQuery.split('/').pop() ?? ''
  return readStudioRawExtension(lastSegment)
}
