import type { ReferenceImage } from '../types/api'

const REFERENCE_IMAGES_START = '[STUDIO_REFERENCE_IMAGES]'
const REFERENCE_IMAGES_END = '[/STUDIO_REFERENCE_IMAGES]'

export function appendStudioReferenceImages(inputText: string, referenceImages: ReferenceImage[]): string {
  const trimmed = inputText.trim()
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
