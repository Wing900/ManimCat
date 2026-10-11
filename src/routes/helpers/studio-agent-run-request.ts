import { z } from 'zod'
import { customApiConfigSchema } from '../schemas/common'
import { normalizeStudioKind } from '../../studio-agent/domain/core-types'

const studioToolChoiceSchema = z.enum(['auto', 'required', 'none'])
/**
 * 浏览器持有的一段对话，重放给下一次 Run。它是**内容而不是身份**：只有角色与正文、有上限，
 * 而且无法点名 Session、Scene 或任何一条已存在的消息。
 */
const studioConversationSchema = z
  .array(
    z.object({
      role: z.enum(['user', 'assistant']),
      text: z.string().min(1).max(64 * 1024),
    })
  )
  .max(200)
  .optional()
const studioKindSchema = z
  .enum(['manim', 'plot', 'matplotlib'])
  .transform((value) => normalizeStudioKind(value) ?? 'manim')

const studioRunControlRequestSchema = z.object({
  projectId: z.string().trim().min(1).optional(),
  inputText: z.string().optional(),
  customApiConfig: customApiConfigSchema.optional(),
  toolChoice: studioToolChoiceSchema.optional(),
  conversation: studioConversationSchema,
})

const studioCreateRunRequestSchema = studioRunControlRequestSchema.extend({
  sessionId: z.string().trim().min(1),
  inputText: z.string(),
})

/**
 * Scene Run body. Identity (Session and Scene) comes from the URL only, so an unknown key —
 * including an attempted `sessionId` or `sceneId` override — is rejected instead of ignored.
 * `code` is content: it names Scenes to write into the workspace, never the Run's scope.
 */
const studioCreateSceneRunRequestSchema = z
  .object({
    projectId: z.string().trim().min(1).optional(),
    inputText: z.string(),
    customApiConfig: customApiConfigSchema.optional(),
    toolChoice: studioToolChoiceSchema.optional(),
    /**
     * Scene sources keyed by Scene id. This is content, not identity: the Session and the current
     * Scene still come from the URL only, so an attempted `sessionId`/`sceneId` override is still
     * rejected by `.strict()`, and the key shape is validated where the files are written.
     */
    code: z.record(z.string(), z.string()).optional(),
    conversation: studioConversationSchema,
  })
  .strict()

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
export type StudioCreateSceneRunRequest = z.infer<typeof studioCreateSceneRunRequestSchema>
export type StudioContinueRunRequest = z.infer<typeof studioContinueRunRequestSchema>
export type StudioCreateSessionRequest = z.infer<typeof studioCreateSessionRequestSchema>

export function parseStudioCreateRunRequest(input: unknown): StudioCreateRunRequest {
  return studioCreateRunRequestSchema.parse(input)
}

export function parseStudioCreateSceneRunRequest(input: unknown): StudioCreateSceneRunRequest {
  return studioCreateSceneRunRequestSchema.parse(input ?? {})
}

export function parseStudioContinueRunRequest(input: unknown): StudioContinueRunRequest {
  return studioContinueRunRequestSchema.parse(input ?? {})
}

export function parseStudioCreateSessionRequest(input: unknown): StudioCreateSessionRequest {
  return studioCreateSessionRequestSchema.parse(input)
}
