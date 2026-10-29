import type { Request, Response } from 'express'
import type {
  StudioAgentEvent,
  StudioScene,
  StudioSceneSnapshot,
  StudioSession
} from '../../studio-agent/domain/types'
import type { StudioStartRunInput, StudioStartRunResult } from '../../studio-agent/runtime/run-service'
import type { StudioConversationSeedInput } from '../../studio-agent/runtime/session-service'
import type { StudioEventStreamInput } from './studio-agent-sse'
import type { StudioEffectiveCustomApiConfigResolution } from './studio-agent-api-config'
import type { ConnectionMode } from '../../access'
import { createLogger } from '../../shared/logging/logger'
import { getStudioTelemetry, readElapsedMs } from '../../studio-agent/infrastructure/telemetry/studio-telemetry'
import { matchesStudioEventScope } from '../../studio-agent/domain/event-scope'
import {
  toPublicStudioSceneEvent,
  toPublicStudioSceneRun,
  toPublicStudioSceneSnapshot
} from '../../studio-agent/http/public-dto'
import { parseStudioCreateSceneRunRequest } from './studio-agent-run-request'
import { resolveStudioSceneScope } from './studio-agent-scene-authorization'
import { sendStudioError, sendStudioSuccess } from './studio-agent-responses'

const logger = createLogger('StudioSceneRoute')

/**
 * Named dependencies of the Scene endpoints.
 *
 * Every side effect the handlers need is a parameter, so the business behaviour (accepted DTO,
 * 400/404/409/503 mapping, exactly one admission call, the SSE subscription and its filter) is
 * described by a specification with a fake dependency bag instead of by a source-text match or a
 * complete service. The route layer is then pure wiring: authenticate, validate the path segments,
 * delegate.
 */
export interface StudioSceneRouteDependencies {
  getScene: (ownerId: string, sceneId: string) => Promise<StudioScene | null>
  getSession: (ownerId: string, sessionId: string) => Promise<StudioSession | null>
  getSceneSnapshot: (
    ownerId: string,
    sessionId: string,
    sceneId: string
  ) => Promise<StudioSceneSnapshot | null>
  startRun: (input: StudioStartRunInput) => Promise<StudioStartRunResult>
  /**
   * Writes a browser-owned conversation the server has not seen (the client data shape) before the
   * Run reads its history. Idempotent: a history already stored here is never overwritten.
   */
  seedConversation: (input: StudioConversationSeedInput) => Promise<number>
  subscribeExternalEvents: StudioEventStreamInput['subscribeExternalEvents']
  /** Transport opener of the SSE stream, injected so a spec can observe it without a socket. */
  openEventStream: (input: StudioEventStreamInput) => void
  resolveEffectiveCustomApiConfig: (input: {
    mode: StudioSceneRunRequestInput['mode']
    requestCustomApiConfig?: StudioStartRunInput['customApiConfig']
    routedCustomApiConfig?: StudioStartRunInput['customApiConfig']
  }) => StudioEffectiveCustomApiConfigResolution
  /** Injectable clock of the SSE helper, forwarded for deterministic lifecycle specs. */
  clock?: StudioEventStreamInput['clock']
}

export interface StudioSceneRunRequestInput {
  res: Response
  ownerId: string
  /** The connection that produced this request; CatKey config may not be overridden. */
  mode: ConnectionMode
  /** Forwarded to the Run so its token-usage checkpoint can write the CatKey ledger. */
  catKeyId?: string
  sessionId: string
  sceneId: string
  body: unknown
  routedCustomApiConfig?: StudioStartRunInput['customApiConfig']
  deps: StudioSceneRouteDependencies
}

/**
 * Create a Run for one Scene.
 *
 * Order is the contract: strict body parse (400) → Scene authorization (one non-enumerating 404) →
 * optional browser-owned conversation seed → exactly one admission call → status mapping
 * (404/409/503) → 202 with only the new conversation records and accepted Run. The
 * authorized Session/Scene pair is reused, so no
 * second, unprotected Session read exists between admission and the response.
 */
export async function handleStudioSceneRunRequest(input: StudioSceneRunRequestInput): Promise<void> {
  const { res, deps } = input
  const requestStartedAt = Date.now()

  let parsed: ReturnType<typeof parseStudioCreateSceneRunRequest>
  try {
    parsed = parseStudioCreateSceneRunRequest(input.body)
  } catch {
    return sendStudioError(res, 400, 'INVALID_INPUT', 'Invalid scene run request')
  }

  const inputText = parsed.inputText
  if (!inputText.trim()) {
    return sendStudioError(res, 400, 'INVALID_INPUT', 'inputText is required')
  }

  const authorized = await resolveStudioSceneScope({
    res,
    ownerId: input.ownerId,
    sessionId: input.sessionId,
    sceneId: input.sceneId,
    getScene: deps.getScene,
    getSession: deps.getSession
  })
  if (!authorized) {
    return
  }

  const { session, scene } = authorized
  const projectId = parsed.projectId ?? 'default-project'
  const customApiConfigResolution = deps.resolveEffectiveCustomApiConfig({
    mode: input.mode,
    requestCustomApiConfig: parsed.customApiConfig,
    routedCustomApiConfig: input.routedCustomApiConfig
  })

  // Stable identifiers and bounded lengths only: never the prompt text, never a filesystem path.
  getStudioTelemetry().event({ studioKind: session.studioKind, name: 'http.scene_run.requested', data: {
    sessionId: session.id,
    sceneId: scene.id,
    projectId,
    inputLength: inputText.length,
    hasCustomApiConfig: customApiConfigResolution.hasUsableCustomApiConfig,
    routeByManimcatKey: customApiConfigResolution.routeByManimcatKey
  } })
  getStudioTelemetry().timeline({ studioKind: session.studioKind, name: 'scene_run.requested', detail: `${inputText.length} chars` })

  // The browser owns the transcript in the client data shape, so the Run has to see it before it
  // reads its history. After authorization on purpose: an unauthorized or malformed request must
  // never write a message.
  if (parsed.conversation?.length) {
    await deps.seedConversation({
      sessionId: session.id,
      // The authorized Scene is the only scope a replay may populate: a Scene Run reads exactly its
      // own Scene history, so Session-wide seed rows would be invisible to it (and could leak a
      // sibling's transcript into a Legacy Run).
      sceneId: scene.id,
      conversation: parsed.conversation,
      agentType: session.agentType
    })
  }

  const started = await deps.startRun({
    ownerId: input.ownerId,
    projectId,
    session,
    sceneId: scene.id,
    inputText,
    // The browser sent the Session's whole Scene source map; the Run writes it into the workspace
    // before the agent starts, so the agent always reads what the user is actually looking at.
    sceneSources: parsed.code,
    customApiConfig: customApiConfigResolution.effectiveCustomApiConfig,
    catKeyId: input.catKeyId,
    toolChoice: parsed.toolChoice
  })

  if (started.status === 'not_found') {
    // The Scene stopped resolving between authorization and admission: same non-enumerating shape.
    return sendStudioError(res, 404, 'NOT_FOUND', 'Scene not found', {
      sessionId: session.id,
      sceneId: scene.id
    })
  }

  if (started.status === 'coordination_unavailable') {
    logger.warn('Scene run rejected: run coordination is unavailable', {
      sessionId: session.id,
      sceneId: scene.id
    })
    return sendStudioError(res, 503, 'SERVICE_UNAVAILABLE', started.message, {
      sessionId: session.id,
      sceneId: scene.id
    })
  }

  if (started.status === 'conflict') {
    logger.warn('Scene run rejected: this scene already has an active run', {
      sessionId: session.id,
      sceneId: scene.id
    })
    return sendStudioError(res, 409, 'WORK_CONFLICT', 'A studio run is already active for this scene', {
      sessionId: session.id,
      sceneId: scene.id
    })
  }

  // Admission already owns these records. A submit never reloads the whole conversation.
  const snapshot: StudioSceneSnapshot = {
    scene,
    messages: [...(started.userMessage ? [started.userMessage] : []), started.assistantMessage],
    runs: [started.run],
    renders: [],
  }

  getStudioTelemetry().event({ studioKind: session.studioKind, name: 'http.scene_run.accepted', data: {
    sessionId: session.id,
    sceneId: scene.id,
    runId: started.run.id,
    assistantMessageId: started.assistantMessage.id,
    durationMs: readElapsedMs(requestStartedAt)
  } })
  getStudioTelemetry().timeline({ studioKind: session.studioKind, name: 'scene_run.accepted', detail: started.run.id })

  sendStudioSuccess(res, {
    ...toPublicStudioSceneSnapshot(snapshot),
    incremental: true,
    run: toPublicStudioSceneRun(started.run)
  }, 202)
}

export interface StudioSceneEventStreamRequestInput {
  req: Request
  res: Response
  ownerId: string
  sessionId: string
  sceneId: string
  deps: StudioSceneRouteDependencies
}

/**
 * One Scene's event stream.
 *
 * Authorization and the 404 shape are decided before any SSE header is written, so a rejected
 * request is plain JSON; the filter then drops sibling Scene events and Legacy Session events while
 * the Event Bus stays Session-keyed.
 */
export async function handleStudioSceneEventStreamRequest(
  input: StudioSceneEventStreamRequestInput
): Promise<void> {
  const { res, deps } = input
  const authorized = await resolveStudioSceneScope({
    res,
    ownerId: input.ownerId,
    sessionId: input.sessionId,
    sceneId: input.sceneId,
    getScene: deps.getScene,
    getSession: deps.getSession
  })
  if (!authorized) {
    return
  }

  const sceneId = authorized.scene.id
  deps.openEventStream({
    req: input.req,
    res,
    sessionId: authorized.session.id,
    sceneId,
    subscribeExternalEvents: deps.subscribeExternalEvents,
    filter: (event: StudioAgentEvent): boolean =>
      matchesStudioEventScope(event, { sessionId: authorized.session.id, sceneId }),
    serializeEvent: toPublicStudioSceneEvent,
    clock: deps.clock
  })
}
