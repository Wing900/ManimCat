import { z } from 'zod'
import { customApiConfigSchema } from '../schemas/common'

const studioCreateRunRequestSchema = z.object({
  sessionId: z.string().trim().min(1),
  inputText: z.string(),
  projectId: z.string().trim().min(1).optional(),
  customApiConfig: customApiConfigSchema.optional(),
})

export type StudioCreateRunRequest = z.infer<typeof studioCreateRunRequestSchema>

export function parseStudioCreateRunRequest(input: unknown): StudioCreateRunRequest {
  return studioCreateRunRequestSchema.parse(input)
}
