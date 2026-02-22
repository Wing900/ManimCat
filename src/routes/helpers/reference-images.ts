import { z } from 'zod'
import type { ReferenceImage } from '../../types'

const MAX_REFERENCE_IMAGES = 3
const MAX_REFERENCE_IMAGE_URL_LENGTH = 2_000_000

export const referenceImageSchema = z
  .object({
    url: z
      .string()
      .trim()
      .min(1, 'Reference image url is required')
      .max(MAX_REFERENCE_IMAGE_URL_LENGTH, 'Reference image is too large'),
    detail: z.enum(['auto', 'low', 'high']).optional()
  })
  .superRefine((value, ctx) => {
    const isHttpUrl = /^https?:\/\//i.test(value.url)
    const isDataUrl = /^data:image\/[a-zA-Z0-9.+-]+;base64,/i.test(value.url)

    if (!isHttpUrl && !isDataUrl) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Reference image only supports http(s) URLs or data URLs'
      })
    }
  })

export const referenceImagesSchema = z
  .array(referenceImageSchema)
  .max(MAX_REFERENCE_IMAGES, `At most ${MAX_REFERENCE_IMAGES} reference images are allowed`)
  .optional()

export function sanitizeReferenceImages(images?: ReferenceImage[]): ReferenceImage[] | undefined {
  if (!images || images.length === 0) {
    return undefined
  }

  return images.map((image) => ({
    url: image.url.trim(),
    detail: image.detail || 'auto'
  }))
}
