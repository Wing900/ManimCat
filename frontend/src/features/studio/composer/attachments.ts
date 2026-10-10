import type { ReferenceImage, VisionImageDetail } from '../../../shared/types/api'
import type { StudioComposerAttachment } from './types'

const REFERENCE_IMAGES_START = '[STUDIO_REFERENCE_IMAGES]'
const REFERENCE_IMAGES_END = '[/STUDIO_REFERENCE_IMAGES]'

export function createComposerImageAttachment(input: {
  url: string
  name?: string
  detail?: VisionImageDetail
  mimeType?: string
  previewUrl?: string
}): StudioComposerAttachment {
  const normalizedName = normalizeAttachmentName(input.name || extractNameFromUrl(input.url) || 'image.png')

  return {
    id: crypto.randomUUID(),
    kind: 'image',
    name: normalizedName,
    tokenLabel: buildAttachmentTokenLabel(normalizedName),
    url: input.url,
    previewUrl: input.previewUrl || input.url,
    detail: input.detail,
    mimeType: input.mimeType,
  }
}

export function appendStudioReferenceImages(inputText: string, attachments: StudioComposerAttachment[]): string {
  const trimmed = inputText.trim()
  const referenceImages = attachmentsToReferenceImages(attachments)
  if (referenceImages.length === 0) {
    return trimmed
  }

  const lines = referenceImages.map((image, index) => (
    `- image_${index + 1}: ${image.url}${image.detail ? ` (detail: ${image.detail})` : ''}`
  ))

  return [
    trimmed,
    '',
    REFERENCE_IMAGES_START,
    'Use the following uploaded images as reference context if needed:',
    ...lines,
    REFERENCE_IMAGES_END,
  ].join('\n')
}

export function stripStudioReferenceImages(inputText: string): string {
  const startIndex = inputText.indexOf(REFERENCE_IMAGES_START)
  if (startIndex < 0) {
    return inputText
  }

  return inputText.slice(0, startIndex).trimEnd()
}

export function hasStudioReferenceImages(inputText: string): boolean {
  return inputText.includes(REFERENCE_IMAGES_START)
}

export function attachmentsToReferenceImages(attachments: StudioComposerAttachment[]): ReferenceImage[] {
  return attachments
    .filter((attachment) => attachment.kind === 'image')
    .map((attachment) => ({
      url: attachment.url,
      detail: attachment.detail,
    }))
}

export function getAttachmentToken(attachment: StudioComposerAttachment): string {
  return `@${attachment.tokenLabel}`
}

export function addAttachmentTokenToInput(inputText: string, attachment: StudioComposerAttachment): string {
  const token = getAttachmentToken(attachment)
  if (containsAttachmentToken(inputText, attachment)) {
    return inputText
  }

  const trimmed = inputText.trim()
  return trimmed ? `${trimmed} ${token}` : token
}

export function removeAttachmentTokenFromInput(inputText: string, attachment: StudioComposerAttachment): string {
  const tokenPattern = new RegExp(`(^|\\s)${escapeRegex(getAttachmentToken(attachment))}(?=\\s|$)`, 'g')
  return inputText
    .replace(tokenPattern, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim()
}

export function filterAttachmentsPresentInInput(
  inputText: string,
  attachments: StudioComposerAttachment[],
): StudioComposerAttachment[] {
  return attachments.filter((attachment) => containsAttachmentToken(inputText, attachment))
}

export function extractNameFromUrl(url: string): string {
  if (!url) {
    return 'image.png'
  }

  try {
    const absolute = /^(data:|https?:\/\/)/i.test(url) ? url : new URL(url, window.location.origin).toString()
    const pathname = new URL(absolute).pathname
    const basename = pathname.split('/').pop()?.trim()
    return basename ? decodeURIComponent(basename) : 'image.png'
  } catch {
    return 'image.png'
  }
}

function containsAttachmentToken(inputText: string, attachment: StudioComposerAttachment): boolean {
  const tokenPattern = new RegExp(`(^|\\s)${escapeRegex(getAttachmentToken(attachment))}(?=\\s|$)`)
  return tokenPattern.test(inputText)
}

function buildAttachmentTokenLabel(name: string): string {
  const stem = name.trim().replace(/^@+/, '')
  const normalized = stem.replace(/\s+/g, '_').replace(/[^\p{L}\p{N}._-]/gu, '')
  return normalized || 'image'
}

function normalizeAttachmentName(name: string): string {
  return name.split(/[\\/]/).pop()?.trim() || 'image.png'
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
