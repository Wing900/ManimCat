import type {
  StudioScene,
  StudioSceneRender,
  StudioSceneRun,
  StudioSceneSnapshot,
} from '../protocol/studio-agent-types'
import type { StudioCinemaSceneEvent } from './types'

/**
 * Shared specs fixtures for the Scene client foundation. This module is test support only: it has
 * no runtime dependency and no test of its own, so no production module imports it.
 */

export const CINEMA_TEST_SESSION_ID = 'session_cinema'
export const CINEMA_TEST_SCENE_A = 'scene_0001'
export const CINEMA_TEST_SCENE_B = 'scene_0002'
export const CINEMA_TEST_SCENE_C = 'scene_0003'
export const CINEMA_TEST_ISO = '2026-03-22T00:00:00.000Z'

export function createTestScene(
  sessionId: string,
  sceneId: string,
  position: number,
): StudioScene {
  return {
    id: sceneId,
    sessionId,
    position,
    createdAt: CINEMA_TEST_ISO,
    updatedAt: CINEMA_TEST_ISO,
  }
}

export function createTestRun(
  sceneId: string,
  runId: string,
  status: StudioSceneRun['status'] = 'running',
  sessionId = CINEMA_TEST_SESSION_ID,
): StudioSceneRun {
  return {
    id: runId,
    sessionId,
    sceneId,
    status,
    inputText: 'draw a circle',
    activeAgent: 'builder',
    createdAt: CINEMA_TEST_ISO,
    ...(status === 'completed' || status === 'failed' || status === 'cancelled'
      ? { completedAt: CINEMA_TEST_ISO }
      : {}),
  }
}

export function createTestRender(
  sceneId: string,
  renderId: string,
  input?: {
    status?: StudioSceneRender['status']
    attachments?: StudioSceneRender['attachments']
    updatedAt?: string
    outputMode?: StudioSceneRender['outputMode']
  },
): StudioSceneRender {
  return {
    id: renderId,
    sessionId: CINEMA_TEST_SESSION_ID,
    sceneId,
    kind: 'manim',
    title: `render ${renderId}`,
    status: input?.status ?? 'completed',
    concept: 'a circle',
    outputMode: input?.outputMode ?? 'video',
    ...(input?.attachments ? { attachments: input.attachments } : {}),
    createdAt: CINEMA_TEST_ISO,
    updatedAt: input?.updatedAt ?? CINEMA_TEST_ISO,
  }
}

export function createTestSceneSnapshot(
  sessionId: string,
  sceneId: string,
  input?: {
    messages?: StudioSceneSnapshot['messages']
    runs?: StudioSceneRun[]
    renders?: StudioSceneRender[]
  },
): StudioSceneSnapshot {
  return {
    scene: createTestScene(sessionId, sceneId, 0),
    messages: input?.messages ?? [],
    runs: input?.runs ?? [],
    renders: input?.renders ?? [],
  }
}

/** A raw wire frame, exactly as `JSON.parse` would hand it to the decoder. */
export function createTestFrame(
  type: string,
  properties: Record<string, unknown>,
): Record<string, unknown> {
  return { type, properties }
}

/** A `data:` locator of an exact payload length, for the media validation specs. */
export function createTestDataUri(mimeType: string, payloadLength = 8): string {
  return `data:${mimeType};base64,${'A'.repeat(payloadLength)}`
}

/** A `run.updated` frame scoped to one Scene; the recovery specs need several distinct records. */
export function createTestRunFrame(run: StudioSceneRun): Record<string, unknown> {
  return createTestFrame('run.updated', { sessionId: CINEMA_TEST_SESSION_ID, run })
}

/** A `assistant.text` frame scoped to one Scene. */
export function createTestTextFrame(sceneId: string, text: string): Record<string, unknown> {
  return createTestFrame('assistant.text', {
    sessionId: CINEMA_TEST_SESSION_ID,
    sceneId,
    runId: 'run_1',
    messageId: 'message_1',
    text,
  })
}

/** A scoped Scene frame of one Scene, with the fields every scoped type shares. */
export function createTestScopedProperties(
  sceneId: string | undefined,
  runId = 'run_1',
  messageId = 'message_1',
): Record<string, unknown> {
  return {
    sessionId: CINEMA_TEST_SESSION_ID,
    ...(sceneId === undefined ? {} : { sceneId }),
    runId,
    messageId,
  }
}

export function createTestAssistantTextEvent(text: string): StudioCinemaSceneEvent {
  return { kind: 'assistant-text', runId: 'run_1', messageId: 'message_1', text }
}

export function createTestToolResultEvent(input?: {
  status?: 'completed' | 'failed'
  output?: string
  callId?: string
}): StudioCinemaSceneEvent {
  return {
    kind: 'tool-result',
    runId: 'run_1',
    messageId: 'message_1',
    toolName: 'static-check',
    callId: input?.callId ?? 'call_1',
    status: input?.status ?? 'completed',
    ...(input?.output === undefined ? {} : { output: input.output }),
  }
}
