import { z } from 'zod'

/** A Session with more Scenes than this is not a realistic Studio state. */
export const STUDIO_SCENE_ORDER_LIMIT = 64

const studioSceneIdSchema = z.string().trim().min(1).max(128)

/** Scene creation takes no client fields, so any unknown key is rejected. */
export const studioCreateSceneRequestSchema = z.object({}).strict()

export const studioSceneOrderRequestSchema = z
  .object({
    sceneIds: z
      .array(studioSceneIdSchema)
      .min(1)
      .max(STUDIO_SCENE_ORDER_LIMIT)
      .refine((sceneIds) => new Set(sceneIds).size === sceneIds.length, {
        message: 'sceneIds must not contain duplicates',
      }),
  })
  .strict()

export type StudioCreateSceneRequest = z.infer<typeof studioCreateSceneRequestSchema>
export type StudioSceneOrderRequest = z.infer<typeof studioSceneOrderRequestSchema>

export function parseStudioCreateSceneRequest(input: unknown): StudioCreateSceneRequest {
  return studioCreateSceneRequestSchema.parse(input ?? {})
}

export function parseStudioSceneOrderRequest(input: unknown): StudioSceneOrderRequest {
  return studioSceneOrderRequestSchema.parse(input)
}
