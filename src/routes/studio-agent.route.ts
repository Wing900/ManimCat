import express from 'express'
import { authMiddleware } from '../middlewares/auth.middleware'
import { asyncHandler } from '../middlewares/error-handler'
import { studioRuntime } from '../studio-agent/runtime/runtime-service'
import {
  isStudioPermissionDecision,
  sendStudioError,
  sendStudioSuccess
} from './helpers/studio-agent-responses'
import { resolveStudioEffectiveCustomApiConfig } from './helpers/studio-agent-api-config'
import { parseStudioPatchSessionRequest } from './helpers/studio-agent-session-control'
import {
  parseStudioContinueRunRequest,
  parseStudioCreateRunRequest,
  parseStudioCreateSessionRequest
} from './helpers/studio-agent-run-request'
import { ensureDefaultStudioWorkspaceExists } from '../studio-agent/workspace/default-studio-workspace'
import { createLogger } from '../utils/logger'
import { resolveCustomApiConfigByManimcatKey } from '../utils/manimcat-routing'
import { logPlotStudioTiming, readElapsedMs } from '../studio-agent/observability/plot-studio-timing'

const router = express.Router()
const logger = createLogger('StudioAgentRoute')

router.post('/studio-agent/sessions', authMiddleware, asyncHandler(async (req, res) => {
  const parsed = parseStudioCreateSessionRequest(req.body)
  const projectId = parsed.projectId ?? 'default-project'
  const directory = parsed.directory ?? ensureDefaultStudioWorkspaceExists()

  const session = await studioRuntime.createSession({
    projectId,
    directory,
    useDedicatedWorkspace: !parsed.directory,
    title: parsed.title,
    studioKind: parsed.studioKind,
    agentType: parsed.agentType,
    permissionLevel: parsed.permissionLevel,
    workspaceId: parsed.workspaceId,
    toolChoice: parsed.toolChoice
  })

  logger.info('Studio session created', {
    sessionId: session.id,
    projectId,
    studioKind: session.studioKind,
    agentType: session.agentType,
    directory: session.directory,
  })

  sendStudioSuccess(res, { session })
}))

router.get('/studio-agent/sessions/:sessionId', authMiddleware, asyncHandler(async (req, res) => {
  const session = await studioRuntime.getSession(req.params.sessionId)
  if (!session) {
    return sendStudioError(res, 404, 'NOT_FOUND', 'Session not found', { sessionId: req.params.sessionId })
  }

  await studioRuntime.syncSession(session.id)

  const [messages, runs, sessionEvents, tasks, works, workResults] = await Promise.all([
    studioRuntime.messageStore.listBySessionId(session.id),
    studioRuntime.runStore.listBySessionId(session.id),
    studioRuntime.sessionEventStore.listBySessionId(session.id),
    studioRuntime.taskStore.listBySessionId(session.id),
    studioRuntime.workStore.listBySessionId(session.id),
    studioRuntime.listWorkResultsBySessionId(session.id)
  ])

  sendStudioSuccess(res, { session, messages, runs, sessionEvents, tasks, works, workResults })
}))

router.patch('/studio-agent/sessions/:sessionId', authMiddleware, asyncHandler(async (req, res) => {
  const parsed = parseStudioPatchSessionRequest(req.body)
  const session = await studioRuntime.updateSession(req.params.sessionId, {
    permissionMode: parsed.permissionMode,
  })

  if (!session) {
    return sendStudioError(res, 404, 'NOT_FOUND', 'Session not found', { sessionId: req.params.sessionId })
  }

  sendStudioSuccess(res, { session })
}))

router.get('/studio-agent/runs/:runId', authMiddleware, asyncHandler(async (req, res) => {
  const run = await studioRuntime.runStore.getById(req.params.runId)
  if (!run) {
    return sendStudioError(res, 404, 'NOT_FOUND', 'Run not found', { runId: req.params.runId })
  }

  sendStudioSuccess(res, { run })
}))

router.get('/studio-agent/tasks/:sessionId', authMiddleware, asyncHandler(async (req, res) => {
  const session = await studioRuntime.getSession(req.params.sessionId)
  if (!session) {
    return sendStudioError(res, 404, 'NOT_FOUND', 'Session not found', { sessionId: req.params.sessionId })
  }

  await studioRuntime.syncSession(session.id)
  const tasks = await studioRuntime.taskStore.listBySessionId(session.id)

  sendStudioSuccess(res, { sessionId: session.id, tasks })
}))

router.get('/studio-agent/works/:sessionId', authMiddleware, asyncHandler(async (req, res) => {
  const session = await studioRuntime.getSession(req.params.sessionId)
  if (!session) {
    return sendStudioError(res, 404, 'NOT_FOUND', 'Session not found', { sessionId: req.params.sessionId })
  }

  await studioRuntime.syncSession(session.id)

  const [sessionEvents, works, workResults] = await Promise.all([
    studioRuntime.sessionEventStore.listBySessionId(session.id),
    studioRuntime.workStore.listBySessionId(session.id),
    studioRuntime.listWorkResultsBySessionId(session.id)
  ])

  sendStudioSuccess(res, { sessionId: session.id, sessionEvents, works, workResults })
}))

router.get('/studio-agent/events', authMiddleware, asyncHandler(async (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache, no-transform')
  res.setHeader('Connection', 'keep-alive')
  res.flushHeaders?.()

  const backlog = studioRuntime.listExternalEvents()
  for (const event of backlog) {
    res.write(`event: ${event.type}\n`)
    res.write(`data: ${JSON.stringify(event)}\n\n`)
  }

  const heartbeat = setInterval(() => {
    res.write('event: studio.heartbeat\n')
    res.write(`data: ${JSON.stringify({ type: 'studio.heartbeat', properties: { timestamp: Date.now() } })}\n\n`)
  }, 15000)

  const unsubscribe = studioRuntime.subscribeExternalEvents((event) => {
    res.write(`event: ${event.type}\n`)
    res.write(`data: ${JSON.stringify(event)}\n\n`)
  })

  res.write('event: studio.connected\n')
  res.write(`data: ${JSON.stringify({ type: 'studio.connected', properties: { timestamp: Date.now() } })}\n\n`)

  req.on('close', () => {
    clearInterval(heartbeat)
    unsubscribe()
    res.end()
  })
}))

router.post('/studio-agent/runs', authMiddleware, asyncHandler(async (req, res) => {
  const requestStartedAt = Date.now()
  const parsed = parseStudioCreateRunRequest(req.body)
  const sessionId = parsed.sessionId
  const inputText = parsed.inputText
  const projectId = parsed.projectId ?? 'default-project'

  if (!sessionId || !inputText.trim()) {
    return sendStudioError(res, 400, 'INVALID_INPUT', 'sessionId and inputText are required')
  }

  const session = await studioRuntime.getSession(sessionId)
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

  const started = await studioRuntime.startRun({
    projectId,
    session,
    inputText,
    customApiConfig: customApiConfigResolution.effectiveCustomApiConfig,
    toolChoice: parsed.toolChoice
  })

  if (!started) {
    logger.warn('Studio run rejected because another run is active', {
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

  await studioRuntime.syncSession(session.id)

  const [messages, sessionEvents, tasks, works, workResults] = await Promise.all([
    studioRuntime.messageStore.listBySessionId(session.id),
    studioRuntime.sessionEventStore.listBySessionId(session.id),
    studioRuntime.taskStore.listBySessionId(session.id),
    studioRuntime.workStore.listBySessionId(session.id),
    studioRuntime.listWorkResultsBySessionId(session.id)
  ])

  sendStudioSuccess(res, {
    run: started.run,
    assistantMessage: started.assistantMessage,
    text: '',
    messages,
    sessionEvents,
    tasks,
    works,
    workResults,
    pendingPermissions: studioRuntime.listPendingPermissions()
  }, 202)
}))

router.post('/studio-agent/runs/:runId/continue', authMiddleware, asyncHandler(async (req, res) => {
  const parsed = parseStudioContinueRunRequest(req.body)
  const projectId = parsed.projectId ?? 'default-project'
  const authenticatedManimcatApiKey = res.locals.manimcatApiKey as string | undefined
  const routedCustomApiConfig = resolveCustomApiConfigByManimcatKey(authenticatedManimcatApiKey)
  const customApiConfigResolution = resolveStudioEffectiveCustomApiConfig({
    requestCustomApiConfig: parsed.customApiConfig,
    routedCustomApiConfig
  })

  const continued = await studioRuntime.continueRun({
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

  if (continued.status !== 'started') {
    return sendStudioError(res, 500, 'INTERNAL_ERROR', 'Unexpected studio continuation state', {
      runId: req.params.runId,
      status: continued.status
    })
  }

  const continuedSession = continued.session
  const continuedAssistantMessage = continued.assistantMessage

  await studioRuntime.syncSession(continuedSession.id)

  const [messages, sessionEvents, tasks, works, workResults] = await Promise.all([
    studioRuntime.messageStore.listBySessionId(continuedSession.id),
    studioRuntime.sessionEventStore.listBySessionId(continuedSession.id),
    studioRuntime.taskStore.listBySessionId(continuedSession.id),
    studioRuntime.workStore.listBySessionId(continuedSession.id),
    studioRuntime.listWorkResultsBySessionId(continuedSession.id)
  ])

  sendStudioSuccess(res, {
    run: continued.run,
    assistantMessage: continuedAssistantMessage,
    text: '',
    messages,
    sessionEvents,
    tasks,
    works,
    workResults,
    pendingPermissions: studioRuntime.listPendingPermissions()
  }, 202)
}))

router.get('/studio-agent/permissions/pending', authMiddleware, asyncHandler(async (_req, res) => {
  sendStudioSuccess(res, { requests: studioRuntime.listPendingPermissions() })
}))

const replyPermissionHandler = asyncHandler(async (req, res) => {
  const requestID = typeof req.params.requestID === 'string' && req.params.requestID.trim()
    ? req.params.requestID.trim()
    : typeof req.body.requestID === 'string'
      ? req.body.requestID.trim()
      : ''
  const reply = req.body.reply

  if (!requestID || !isStudioPermissionDecision(reply)) {
    return sendStudioError(
      res,
      400,
      'INVALID_INPUT',
      'requestID and reply are required; reply must be one of: once, always, reject'
    )
  }

  const ok = studioRuntime.replyPermission({
    requestID,
    reply,
    message: typeof req.body.message === 'string' ? req.body.message : undefined,
    directory: typeof req.body.directory === 'string' ? req.body.directory : undefined
  })

  if (!ok) {
    return sendStudioError(res, 404, 'NOT_FOUND', 'Permission request not found', { requestID })
  }

  sendStudioSuccess(res, { requests: studioRuntime.listPendingPermissions() })
})

router.post('/studio-agent/permissions/reply', authMiddleware, replyPermissionHandler)
router.post('/studio-agent/permissions/:requestID/reply', authMiddleware, replyPermissionHandler)

export default router
