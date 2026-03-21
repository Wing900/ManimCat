import express from 'express'
import { authMiddleware } from '../middlewares/auth.middleware'
import { asyncHandler } from '../middlewares/error-handler'
import { studioRuntime } from '../studio-agent/runtime/runtime-service'
import {
  isStudioPermissionDecision,
  sendStudioError,
  sendStudioSuccess
} from './helpers/studio-agent-responses'
import { parseStudioCreateRunRequest } from './helpers/studio-agent-run-request'

const router = express.Router()

router.post('/studio-agent/sessions', authMiddleware, asyncHandler(async (req, res) => {
  const projectId = typeof req.body.projectId === 'string' && req.body.projectId.trim()
    ? req.body.projectId.trim()
    : 'default-project'
  const directory = typeof req.body.directory === 'string' && req.body.directory.trim()
    ? req.body.directory.trim()
    : process.cwd()

  const session = await studioRuntime.createSession({
    projectId,
    directory,
    title: typeof req.body.title === 'string' ? req.body.title : undefined,
    agentType: req.body.agentType,
    permissionLevel: req.body.permissionLevel,
    workspaceId: typeof req.body.workspaceId === 'string' ? req.body.workspaceId : undefined
  })

  sendStudioSuccess(res, { session })
}))

router.get('/studio-agent/sessions/:sessionId', authMiddleware, asyncHandler(async (req, res) => {
  const session = await studioRuntime.getSession(req.params.sessionId)
  if (!session) {
    return sendStudioError(res, 404, 'NOT_FOUND', 'Session not found', { sessionId: req.params.sessionId })
  }

  await studioRuntime.syncSession(session.id)

  const [messages, runs, tasks, works, workResults] = await Promise.all([
    studioRuntime.messageStore.listBySessionId(session.id),
    studioRuntime.runStore.listBySessionId(session.id),
    studioRuntime.taskStore.listBySessionId(session.id),
    studioRuntime.workStore.listBySessionId(session.id),
    studioRuntime.listWorkResultsBySessionId(session.id)
  ])

  sendStudioSuccess(res, { session, messages, runs, tasks, works, workResults })
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

  const [works, workResults] = await Promise.all([
    studioRuntime.workStore.listBySessionId(session.id),
    studioRuntime.listWorkResultsBySessionId(session.id)
  ])

  sendStudioSuccess(res, { sessionId: session.id, works, workResults })
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

  const result = await studioRuntime.runtime.run({
    projectId,
    session,
    inputText,
    customApiConfig: parsed.customApiConfig
  })

  await studioRuntime.syncSession(session.id)

  const [messages, tasks, works, workResults] = await Promise.all([
    studioRuntime.messageStore.listBySessionId(session.id),
    studioRuntime.taskStore.listBySessionId(session.id),
    studioRuntime.workStore.listBySessionId(session.id),
    studioRuntime.listWorkResultsBySessionId(session.id)
  ])

  sendStudioSuccess(res, {
    run: result.run,
    assistantMessage: result.assistantMessage,
    text: result.text,
    messages,
    tasks,
    works,
    workResults,
    pendingPermissions: studioRuntime.listPendingPermissions()
  })
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
