import { z } from 'zod'

export const studioPermissionModeSchema = z.enum(['safe', 'auto', 'full'])

export const studioPatchSessionRequestSchema = z.object({
  permissionMode: studioPermissionModeSchema.optional(),
})

export type StudioPatchSessionRequest = z.infer<typeof studioPatchSessionRequestSchema>

export function parseStudioPatchSessionRequest(input: unknown): StudioPatchSessionRequest {
  return studioPatchSessionRequestSchema.parse(input)
}
