import { z } from 'zod'
import { customApiConfigSchema } from '../schemas/common'

const studioToolChoiceSchema = z.enum(['auto', 'required', 'none'])
const studioKindSchema = z.enum(['manim', 'plot'])

const studioRunControlRequestSchema = z.object({
  projectId: z.string().trim().min(1).optional(),
  inputText: z.string().optional(),
  customApiConfig: customApiConfigSchema.optional(),
  toolChoice: studioToolChoiceSchema.optional(),
})

const studioCreateRunRequestSchema = studioRunControlRequestSchema.extend({
  sessionId: z.string().trim().min(1),
  inputText: z.string(),
})

const studioContinueRunRequestSchema = studioRunControlRequestSchema

export const studioCreateSessionRequestSchema = z.object({
  projectId: z.string().trim().min(1).optional(),
  title: z.string().optional(),
  studioKind: studioKindSchema.optional(),
  agentType: z.enum(['builder']).optional(),
  workspaceId: z.string().optional(),
  toolChoice: studioToolChoiceSchema.optional(),
}).strict()

export type StudioCreateRunRequest = z.infer<typeof studioCreateRunRequestSchema>
export type StudioContinueRunRequest = z.infer<typeof studioContinueRunRequestSchema>
export type StudioCreateSessionRequest = z.infer<typeof studioCreateSessionRequestSchema>

export function parseStudioCreateRunRequest(input: unknown): StudioCreateRunRequest {
  return studioCreateRunRequestSchema.parse(input)
}

export function parseStudioContinueRunRequest(input: unknown): StudioContinueRunRequest {
  return studioContinueRunRequestSchema.parse(input ?? {})
}

export function parseStudioCreateSessionRequest(input: unknown): StudioCreateSessionRequest {
  return studioCreateSessionRequestSchema.parse(input)
}
