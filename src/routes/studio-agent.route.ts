import express from 'express'
import { authMiddleware } from '../middlewares/auth.middleware'
import { asyncHandler } from '../middlewares/error-handler'
import { studioRuntime } from '../studio-agent/runtime/runtime-service'
import {
  sendStudioError,
  sendStudioSuccess
} from './helpers/studio-agent-responses'
import { resolveStudioEffectiveCustomApiConfig } from './helpers/studio-agent-api-config'
import {
  parseStudioContinueRunRequest,
  parseStudioCreateRunRequest,
  parseStudioCreateSessionRequest
} from './helpers/studio-agent-run-request'
import { openStudioAgentEventStream } from './helpers/studio-agent-sse'
import {
  handleStudioSceneEventStreamRequest,
  handleStudioSceneRunRequest,
  type StudioSceneRouteDependencies
} from './helpers/studio-agent-scene-handlers'
import { parseStudioScenePathParams } from './helpers/studio-agent-scene-params'
import {
  studioCreateSceneRequestSchema,
  studioSceneOrderRequestSchema
} from './helpers/studio-agent-scene-request'
import { ensureDefaultStudioWorkspaceExists } from '../studio-agent/workspace/default-studio-workspace'
import { requireStudioPrincipal } from '../studio-agent/auth/principal'
import { createLogger } from '../utils/logger'
import { resolveCustomApiConfigByManimcatKey } from '../utils/manimcat-routing'
import { logPlotStudioTiming, logTimeline, readElapsedMs } from '../studio-agent/observability/plot-studio-timing'
import type { StudioSessionSnapshot } from '../studio-agent/domain/types'
import {
  toPublicStudioEvent,
  toPublicStudioRun,
  toPublicStudioScene,
  toPublicStudioSceneSnapshot,
  toPublicStudioSession,
  toPublicStudioSnapshot,
} from '../studio-agent/http/public-dto'

const router = express.Router()
const logger = createLogger('StudioAgentRoute')

/**
 * Wired dependencies of the Scene endpoints. The route authenticates and validates the path
 * segments; every store read, admission call and transport write goes through this bag, so the
 * handlers can be described by a specification with fakes.
 */
const studioSceneRouteDependencies: StudioSceneRouteDependencies = {
  getScene: (ownerId, sceneId) => studioRuntime.getScene(ownerId, sceneId),
  getSession: (ownerId, sessionId) => studioRuntime.getSession(ownerId, sessionId),
  getSceneSnapshot: (ownerId, sessionId, sceneId) => studioRuntime.getSceneSnapshot(ownerId, sessionId, sceneId),
  startRun: (input) => studioRuntime.startRun(input),
  subscribeExternalEvents: studioRuntime.subscribeExternalEvents,
  openEventStream: openStudioAgentEventStream,
  resolveEffectiveCustomApiConfig: resolveStudioEffectiveCustomApiConfig,
}

router.post('/studio-agent/sessions', authMiddleware, asyncHandler(async (req, res) => {
  const parsed = parseStudioCreateSessionRequest(req.body)
  const principal = requireStudioPrincipal(res)
  const projectId = parsed.projectId ?? 'default-project'
  ensureDefaultStudioWorkspaceExists()

  const session = await studioRuntime.createSession({
    ownerId: principal.ownerId,
    projectId,
    useDedicatedWorkspace: true,
    title: parsed.title,
    studioKind: parsed.studioKind,
    agentType: parsed.agentType,
    workspaceId: parsed.workspaceId,
    toolChoice: parsed.toolChoice
  })

  logger.info('Studio session created', {
    sessionId: session.id,
    projectId,
    studioKind: session.studioKind,
    agentType: session.agentType,
  })

  sendStudioSuccess(res, { session: toPublicStudioSession(session) })
}))

router.get('/studio-agent/sessions/:sessionId', authMiddleware, asyncHandler(async (req, res) => {
  const principal = requireStudioPrincipal(res)
  const snapshot = await studioRuntime.getSessionSnapshot(principal.ownerId, req.params.sessionId)
  if (!snapshot) {
    return sendStudioError(res, 404, 'NOT_FOUND', 'Session not found', { sessionId: req.params.sessionId })
  }

  sendStudioSuccess(res, toPublicStudioSnapshot(snapshot))
}))

router.post('/studio-agent/sessions/:sessionId/scenes', authMiddleware, asyncHandler(async (req, res) => {
  const principal = requireStudioPrincipal(res)
  if (!studioCreateSceneRequestSchema.safeParse(req.body ?? {}).success) {
    return sendStudioError(res, 400, 'INVALID_INPUT', 'Invalid scene creation request')
  }

  const outcome = await studioRuntime.createScene({
    ownerId: principal.ownerId,
    sessionId: req.params.sessionId
  })

  if (outcome.status === 'session_not_found') {
    // An absent and a foreign Session share one public shape.
    return sendStudioError(res, 404, 'NOT_FOUND', 'Session not found', { sessionId: req.params.sessionId })
  }

  if (outcome.status === 'source_conflict') {
    return sendStudioError(res, 409, 'WORK_CONFLICT', 'A scene source already exists for this scene')
  }

  if (outcome.status === 'source_rejected') {
    return sendStudioError(res, 409, 'WORK_CONFLICT', 'A scene source cannot be created for this session')
  }

  if (outcome.status === 'persistence_failed') {
    return sendStudioError(res, 503, 'SERVICE_UNAVAILABLE', 'Scene persistence is unavailable')
  }

  sendStudioSuccess(res, { scene: toPublicStudioScene(outcome.scene) }, 201)
}))

router.put('/studio-agent/sessions/:sessionId/scenes/order', authMiddleware, asyncHandler(async (req, res) => {
  const principal = requireStudioPrincipal(res)
  const parsed = studioSceneOrderRequestSchema.safeParse(req.body)
  if (!parsed.success) {
    return sendStudioError(res, 400, 'INVALID_INPUT', 'Invalid scene order request')
  }

  const outcome = await studioRuntime.reorderScenes({
    ownerId: principal.ownerId,
    sessionId: req.params.sessionId,
    sceneIds: parsed.data.sceneIds
  })

  if (outcome.status === 'session_not_found') {
    return sendStudioError(res, 404, 'NOT_FOUND', 'Session not found', { sessionId: req.params.sessionId })
  }

  if (outcome.status === 'invalid_order') {
    // Well-formed payload whose ids do not match the persisted Scene set. The reason stays
    // server-side: it would otherwise disclose ownership facts.
    return sendStudioError(res, 409, 'WORK_CONFLICT', 'Scene order does not match the session scenes')
  }

  if (outcome.status === 'persistence_failed') {
    return sendStudioError(res, 503, 'SERVICE_UNAVAILABLE', 'Scene persistence is unavailable')
  }

  sendStudioSuccess(res, { scenes: outcome.scenes.map(toPublicStudioScene) })
}))

router.get('/studio-agent/sessions/:sessionId/scenes/:sceneId', authMiddleware, asyncHandler(async (req, res) => {
  const principal = requireStudioPrincipal(res)
  const params = parseStudioScenePathParams(req.params)
  if (!params) {
    return sendStudioError(res, 400, 'INVALID_INPUT', 'Invalid session or scene identifier')
  }

  let snapshot: Awaited<ReturnType<typeof studioRuntime.getSceneSnapshot>>
  try {
    snapshot = await studioRuntime.getSceneSnapshot(
      principal.ownerId,
      params.sessionId,
      params.sceneId
    )
  } catch (error) {
    logger.error('Studio scene snapshot failed', {
      sessionId: params.sessionId,
      sceneId: params.sceneId,
      reason: error instanceof Error ? error.message : String(error),
    })
    return sendStudioError(res, 503, 'SERVICE_UNAVAILABLE', 'Scene persistence is unavailable')
  }

  if (!snapshot) {
    // An absent Session, an absent Scene, a foreign owner and a Scene of another Session all
    // collapse into this one shape; the body discloses no ownership distinction.
    return sendStudioError(res, 404, 'NOT_FOUND', 'Scene not found', {
      sessionId: params.sessionId,
      sceneId: params.sceneId
    })
  }

  sendStudioSuccess(res, toPublicStudioSceneSnapshot(snapshot))
}))

router.get('/studio-agent/runs/:runId', authMiddleware, asyncHandler(async (req, res) => {
  const principal = requireStudioPrincipal(res)
  const run = await studioRuntime.getRun(principal.ownerId, req.params.runId)
  if (!run) {
    return sendStudioError(res, 404, 'NOT_FOUND', 'Run not found', { runId: req.params.runId })
  }

  sendStudioSuccess(res, { run: toPublicStudioRun(run) })
}))

router.get('/studio-agent/sessions/:sessionId/events', authMiddleware, asyncHandler(async (req, res) => {
  const principal = requireStudioPrincipal(res)
  const sessionId = req.params.sessionId
  const session = await studioRuntime.getSession(principal.ownerId, sessionId)
  if (!session) {
    return sendStudioError(res, 404, 'NOT_FOUND', 'Session not found', { sessionId })
  }

  openStudioAgentEventStream({
    req,
    res,
    sessionId,
    subscribeExternalEvents: studioRuntime.subscribeExternalEvents,
    serializeEvent: toPublicStudioEvent,
  })
}))

/**
 * One Scene's event stream. Authorization and the 404 shape are decided before any SSE header is
 * written, so a rejected request is plain JSON; the filter then drops sibling Scene events and
 * Legacy Session events while the Event Bus stays Session-keyed.
 */
router.get('/studio-agent/sessions/:sessionId/scenes/:sceneId/events', authMiddleware, asyncHandler(async (req, res) => {
  const principal = requireStudioPrincipal(res)
  const params = parseStudioScenePathParams(req.params)
  if (!params) {
    return sendStudioError(res, 400, 'INVALID_INPUT', 'Invalid session or scene identifier')
  }

  await handleStudioSceneEventStreamRequest({
    req,
    res,
    ownerId: principal.ownerId,
    sessionId: params.sessionId,
    sceneId: params.sceneId,
    deps: studioSceneRouteDependencies,
  })
}))

/**
 * Create a Run for one Scene. The URL owns Session and Scene identity: the body parser is strict,
 * so an attempted `sessionId`/`sceneId` override is rejected instead of ignored, and the Scene is
 * proved to belong to the authenticated owner and to the URL Session before admission.
 */
router.post('/studio-agent/sessions/:sessionId/scenes/:sceneId/runs', authMiddleware, asyncHandler(async (req, res) => {
  const principal = requireStudioPrincipal(res)
  const params = parseStudioScenePathParams(req.params)
  if (!params) {
    return sendStudioError(res, 400, 'INVALID_INPUT', 'Invalid session or scene identifier')
  }

  const authenticatedManimcatApiKey = res.locals.manimcatApiKey as string | undefined
  const routedCustomApiConfig = resolveCustomApiConfigByManimcatKey(authenticatedManimcatApiKey)

  await handleStudioSceneRunRequest({
    res,
    ownerId: principal.ownerId,
    sessionId: params.sessionId,
    sceneId: params.sceneId,
    body: req.body,
    routedCustomApiConfig,
    deps: studioSceneRouteDependencies,
  })
}))

router.post('/studio-agent/runs', authMiddleware, asyncHandler(async (req, res) => {
  const requestStartedAt = Date.now()
  const parsed = parseStudioCreateRunRequest(req.body)
  const principal = requireStudioPrincipal(res)
  const sessionId = parsed.sessionId
  const inputText = parsed.inputText
  const projectId = parsed.projectId ?? 'default-project'

  if (!sessionId || !inputText.trim()) {
    return sendStudioError(res, 400, 'INVALID_INPUT', 'sessionId and inputText are required')
  }

  const session = await studioRuntime.getSession(principal.ownerId, sessionId)
  if (!session) {
    return sendStudioError(res, 404, 'NOT_FOUND', 'Session not found', { sessionId })
  }

  const authenticatedManimcatApiKey = res.locals.manimcatApiKey as string | undefined
  const routedCustomApiConfig = resolveCustomApiConfigByManimcatKey(authenticatedManimcatApiKey)
  const customApiConfigResolution = resolveStudioEffectiveCustomApiConfig({
    requestCustomApiConfig: parsed.customApiConfig,
    routedCustomApiConfig
  })

  logPlotStudioTiming(session.studioKind, 'http.run.requested', {
    sessionId,
    projectId,
    inputLength: inputText.length,
    hasCustomApiConfig: customApiConfigResolution.hasUsableCustomApiConfig,
    routeByManimcatKey: customApiConfigResolution.routeByManimcatKey,
  })
  logTimeline(session.studioKind, 'run.requested', JSON.stringify(inputText.slice(0, 20)))

  const started = await studioRuntime.startRun({
    ownerId: principal.ownerId,
    projectId,
    session,
    inputText,
    customApiConfig: customApiConfigResolution.effectiveCustomApiConfig,
    toolChoice: parsed.toolChoice
  })

  if (started.status === 'not_found') {
    // The Session stopped resolving between the lookup and admission; the client must not read the
    // Run fields of a failed admission.
    return sendStudioError(res, 404, 'NOT_FOUND', 'Session not found', { sessionId })
  }

  if (started.status === 'coordination_unavailable') {
    // Distinct from a conflict: the coordination layer could not answer, so retrying later is
    // the right client action instead of giving up on the session.
    logger.warn('工作室运行被拒绝：Run 协调层不可用', {
      sessionId,
    })
    return sendStudioError(res, 503, 'SERVICE_UNAVAILABLE', started.message)
  }

  if (started.status === 'conflict') {
    logger.warn('工作室运行被拒绝：当前 session 已有运行中的任务', {
      sessionId,
    })
    return sendStudioError(res, 409, 'WORK_CONFLICT', 'A studio run is already active for this session', {
      sessionId,
    })
  }

  logPlotStudioTiming(session.studioKind, 'http.run.accepted', {
    sessionId,
    runId: started.run.id,
    assistantMessageId: started.assistantMessage.id,
    durationMs: readElapsedMs(requestStartedAt),
  })
  logTimeline(session.studioKind, 'run.accepted', started.run.id)

  const snapshot = await studioRuntime.getSessionSnapshot(principal.ownerId, session.id)
  if (!snapshot) {
    return sendStudioError(res, 404, 'NOT_FOUND', 'Session not found', { sessionId: session.id })
  }

  sendStudioSuccess(res, {
    run: toPublicStudioRun(started.run),
    assistantMessage: started.assistantMessage,
    text: '',
    ...withoutSession(snapshot)
  }, 202)
}))

router.post('/studio-agent/runs/:runId/continue', authMiddleware, asyncHandler(async (req, res) => {
  const parsed = parseStudioContinueRunRequest(req.body)
  const principal = requireStudioPrincipal(res)
  const projectId = parsed.projectId ?? 'default-project'
  const authenticatedManimcatApiKey = res.locals.manimcatApiKey as string | undefined
  const routedCustomApiConfig = resolveCustomApiConfigByManimcatKey(authenticatedManimcatApiKey)
  const customApiConfigResolution = resolveStudioEffectiveCustomApiConfig({
    requestCustomApiConfig: parsed.customApiConfig,
    routedCustomApiConfig
  })

  const continued = await studioRuntime.continueRun({
    ownerId: principal.ownerId,
    projectId,
    sourceRunId: req.params.runId,
    inputText: parsed.inputText,
    customApiConfig: customApiConfigResolution.effectiveCustomApiConfig,
    toolChoice: parsed.toolChoice
  })

  if (continued.status === 'not_found') {
    return sendStudioError(res, 404, 'NOT_FOUND', 'Run or session not found', { runId: req.params.runId })
  }

  if (continued.status === 'not_resumable') {
    return sendStudioError(res, 409, 'WORK_CONFLICT', 'This studio run is not resumable', {
      runId: req.params.runId,
      sessionId: continued.session?.id
    })
  }

  if (continued.status === 'conflict') {
    return sendStudioError(res, 409, 'WORK_CONFLICT', 'A studio run is already active for this session', {
      runId: req.params.runId,
      sessionId: continued.session?.id
    })
  }

  if (continued.status === 'coordination_unavailable') {
    return sendStudioError(res, 503, 'SERVICE_UNAVAILABLE', continued.message, {
      runId: req.params.runId,
      sessionId: continued.session?.id
    })
  }

  if (continued.status !== 'started') {
    return sendStudioError(res, 500, 'INTERNAL_ERROR', 'Unexpected studio continuation state', {
      runId: req.params.runId,
      status: continued.status
    })
  }

  const continuedSession = continued.session
  const continuedAssistantMessage = continued.assistantMessage

  const snapshot = await studioRuntime.getSessionSnapshot(principal.ownerId, continuedSession.id)
  if (!snapshot) {
    return sendStudioError(res, 404, 'NOT_FOUND', 'Session not found', { sessionId: continuedSession.id })
  }

  sendStudioSuccess(res, {
    run: toPublicStudioRun(continued.run),
    assistantMessage: continuedAssistantMessage,
    text: '',
    ...withoutSession(snapshot)
  }, 202)
}))

router.post('/studio-agent/runs/:runId/cancel', authMiddleware, asyncHandler(async (req, res) => {
  const principal = requireStudioPrincipal(res)
  const cancelled = await studioRuntime.cancelRun({
    ownerId: principal.ownerId,
    runId: req.params.runId,
    reason: typeof req.body?.reason === 'string' ? req.body.reason : undefined,
  })

  if (cancelled.status === 'not_found') {
    return sendStudioError(res, 404, 'NOT_FOUND', 'Run not found', { runId: req.params.runId })
  }

  if (cancelled.status === 'already_finished') {
    return sendStudioSuccess(res, {
      run: cancelled.run ? toPublicStudioRun(cancelled.run) : undefined,
      status: cancelled.run?.status ?? 'completed',
      message: 'Run already finished',
    })
  }

  if (cancelled.status === 'coordination_unavailable') {
    // The durable cancellation could not be recorded, so remote cancellation is not claimed.
    return sendStudioError(res, 503, 'SERVICE_UNAVAILABLE', cancelled.message, { runId: req.params.runId })
  }

  sendStudioSuccess(res, {
    run: cancelled.run ? toPublicStudioRun(cancelled.run) : undefined,
    status: 'cancelled',
    message: 'Run cancelled',
  })
}))

export default router

function withoutSession(snapshot: StudioSessionSnapshot): Omit<ReturnType<typeof toPublicStudioSnapshot>, 'session'> {
  const { session: _session, ...rest } = toPublicStudioSnapshot(snapshot)
  return rest
}
