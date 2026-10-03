import type { Request, Response } from 'express'
import type {
  StudioAgentEvent,
  StudioScene,
  StudioSceneSnapshot,
  StudioSession
} from '../../studio-agent/domain/types'
import type { StudioExternalEvent } from '../../studio-agent/events/studio-event-adapter'
import type { StudioStartRunInput, StudioStartRunResult } from '../../studio-agent/runtime/run-service'
import type { StudioEventStreamInput } from './studio-agent-sse'
import type { StudioEffectiveCustomApiConfigResolution } from './studio-agent-api-config'
import { createLogger } from '../../utils/logger'
import { logPlotStudioTiming, logTimeline, readElapsedMs } from '../../studio-agent/observability/plot-studio-timing'
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
  subscribeExternalEvents: StudioEventStreamInput['subscribeExternalEvents']
  /** Transport opener of the SSE stream, injected so a spec can observe it without a socket. */
  openEventStream: (input: StudioEventStreamInput) => void
  resolveEffectiveCustomApiConfig: (input: {
    requestCustomApiConfig?: StudioStartRunInput['customApiConfig']
    routedCustomApiConfig?: StudioStartRunInput['customApiConfig']
  }) => StudioEffectiveCustomApiConfigResolution
  /** Injectable clock of the SSE helper, forwarded for deterministic lifecycle specs. */
  clock?: StudioEventStreamInput['clock']
}

export interface StudioSceneRunRequestInput {
  res: Response
  ownerId: string
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
 * exactly one admission call → status mapping (404/409/503) → Scene snapshot → 202 with the Scene
 * public projection plus the accepted Run. The authorized Session/Scene pair is reused, so no
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
    requestCustomApiConfig: parsed.customApiConfig,
    routedCustomApiConfig: input.routedCustomApiConfig
  })

  // Stable identifiers and bounded lengths only: never the prompt text, never a filesystem path.
  logPlotStudioTiming(session.studioKind, 'http.scene_run.requested', {
    sessionId: session.id,
    sceneId: scene.id,
    projectId,
    inputLength: inputText.length,
    hasCustomApiConfig: customApiConfigResolution.hasUsableCustomApiConfig,
    routeByManimcatKey: customApiConfigResolution.routeByManimcatKey
  })
  logTimeline(session.studioKind, 'scene_run.requested', `${inputText.length} chars`)

  const started = await deps.startRun({
    ownerId: input.ownerId,
    projectId,
    session,
    sceneId: scene.id,
    inputText,
    customApiConfig: customApiConfigResolution.effectiveCustomApiConfig,
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

  // The accepted Run is already persisted, so the snapshot loaded now contains it; the explicit
  // `run` field is the canonical accepted Run of this request.
  let snapshot: StudioSceneSnapshot | null
  try {
    snapshot = await deps.getSceneSnapshot(input.ownerId, session.id, scene.id)
  } catch (error) {
    logger.error('Scene run snapshot failed', {
      sessionId: session.id,
      sceneId: scene.id,
      reason: error instanceof Error ? error.message : String(error)
    })
    return sendStudioError(res, 503, 'SERVICE_UNAVAILABLE', 'Scene persistence is unavailable')
  }

  if (!snapshot) {
    return sendStudioError(res, 404, 'NOT_FOUND', 'Scene not found', {
      sessionId: session.id,
      sceneId: scene.id
    })
  }

  logPlotStudioTiming(session.studioKind, 'http.scene_run.accepted', {
    sessionId: session.id,
    sceneId: scene.id,
    runId: started.run.id,
    assistantMessageId: started.assistantMessage.id,
    durationMs: readElapsedMs(requestStartedAt)
  })
  logTimeline(session.studioKind, 'scene_run.accepted', started.run.id)

  sendStudioSuccess(res, {
    ...toPublicStudioSceneSnapshot(snapshot),
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
    serializeEvent: (event: StudioExternalEvent): StudioExternalEvent => toPublicStudioSceneEvent(event),
    clock: deps.clock
  })
}
