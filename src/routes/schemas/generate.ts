import { z } from 'zod'
import {
  customApiConfigSchema,
  promptOverridesSchema,
  qualitySchema,
  videoConfigSchema
} from './common'
import { referenceImagesSchema } from '../helpers/reference-images'

const problemPlanSchema = z.object({
  mode: z.enum(['clarify', 'invent']),
  headline: z.string(),
  summary: z.string(),
  steps: z.array(z.object({
    title: z.string(),
    content: z.string()
  })).max(6),
  visualMotif: z.string(),
  designerHint: z.string()
})

export const generateBodySchema = z.object({
  concept: z.string().min(1, '概念必填'),
  problemPlan: problemPlanSchema.optional(),
  outputMode: z.enum(['video', 'image']),
  quality: qualitySchema.optional().default('low'),
  referenceImages: referenceImagesSchema,
  code: z.string().optional(),
  customApiConfig: customApiConfigSchema.optional(),
  promptOverrides: promptOverridesSchema.optional(),
  videoConfig: videoConfigSchema.optional(),
  renderCacheKey: z.string().min(1).optional()
})
