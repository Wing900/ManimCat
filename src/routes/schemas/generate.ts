import { z } from 'zod'
import {
  customApiConfigSchema,
  promptOverridesSchema,
  qualitySchema,
  videoConfigSchema
} from './common'
import { referenceImagesSchema } from '../helpers/reference-images'
import { problemPlanSchema } from './problem-plan'

export const generateBodySchema = z.object({
  concept: z.string().min(1, '概念必填'),
  problemPlan: problemPlanSchema.optional(),
  outputMode: z.enum(['video', 'image']),
  quality: qualitySchema.optional().default('high'),
  referenceImages: referenceImagesSchema,
  code: z.string().optional(),
  customApiConfig: customApiConfigSchema.optional(),
  promptOverrides: promptOverridesSchema.optional(),
  videoConfig: videoConfigSchema.optional(),
  renderCacheKey: z.string().min(1).optional()
})
