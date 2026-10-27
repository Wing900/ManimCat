import { z } from 'zod'
import { DEFAULT_NARRATION_CONFIG } from '../../workflow/narration/types'

export const qualitySchema = z.enum(['low', 'medium', 'high'])

export const narrationConfigSchema = z.object({
  enabled: z.boolean().default(DEFAULT_NARRATION_CONFIG.enabled),
  voice: z.string().min(1).max(100).default(DEFAULT_NARRATION_CONFIG.voice),
  // Same signed percent form Edge TTS consumes (e.g. +0%, -10%).
  rate: z.string().min(1).max(20).regex(/^[+-]\d{1,3}%$/).default(DEFAULT_NARRATION_CONFIG.rate)
})

export const customApiConfigSchema = z.object({
  apiUrl: z.string(),
  apiKey: z.string(),
  model: z.string()
})

export const promptOverridesSchema = z.object({
  locale: z.enum(['zh-CN', 'en-US']).optional(),
  roles: z
    .object({
      problemFraming: z
        .object({
          system: z.string().max(20000).optional(),
          user: z.string().max(20000).optional()
        })
        .optional(),
      conceptDesigner: z
        .object({
          system: z.string().max(20000).optional(),
          user: z.string().max(20000).optional()
        })
        .optional(),
      codeGeneration: z
        .object({
          system: z.string().max(20000).optional(),
          user: z.string().max(20000).optional()
        })
        .optional(),
      codeRetry: z
        .object({
          system: z.string().max(20000).optional(),
          user: z.string().max(20000).optional()
        })
        .optional(),
      codeEdit: z
        .object({
          system: z.string().max(20000).optional(),
          user: z.string().max(20000).optional()
        })
        .optional()
    })
    .optional(),
  shared: z
    .object({
      apiIndex: z.string().max(40000).optional(),
      specification: z.string().max(40000).optional()
    })
    .optional()
})

export const videoConfigSchema = z.object({
  quality: qualitySchema.optional(),
  frameRate: z.number().int().min(1).max(120).optional(),
  timeout: z.number().optional(),
  narration: narrationConfigSchema.optional()
})
