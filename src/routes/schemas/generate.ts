import { z } from 'zod'
import {
  customApiConfigSchema,
  promptOverridesSchema,
  qualitySchema,
  videoConfigSchema
} from './common'
import { referenceImagesSchema } from '../helpers/reference-images'

export const generateBodySchema = z.object({
  concept: z.string().min(1, '概念必填'),
  outputMode: z.enum(['video', 'image']),
  quality: qualitySchema.optional().default('low'),
  referenceImages: referenceImagesSchema,
  code: z.string().optional(),
  customApiConfig: customApiConfigSchema.optional(),
  promptOverrides: promptOverridesSchema.optional(),
  videoConfig: videoConfigSchema.optional()
})
