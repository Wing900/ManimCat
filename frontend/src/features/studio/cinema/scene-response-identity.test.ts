import { describe, expect, it } from 'vitest'
import {
  CINEMA_TEST_SCENE_A,
  CINEMA_TEST_SCENE_B,
  CINEMA_TEST_SESSION_ID,
  createTestRender,
  createTestRun,
  createTestSceneSnapshot,
} from './cinema-fixtures'
import {
  isStudioCinemaAcceptedRunResponseForIdentity,
  isStudioCinemaSceneSnapshotForIdentity,
  isStudioCinemaScopedRecordForIdentity,
} from './scene-response-identity'

/**
 * Task 11C7-A: the shared response identity rule. It is pure (no React, no network) and it is the
 * single place where a payload is proven to belong to the Scene an action names.
 */

const IDENTITY_A = { sessionId: CINEMA_TEST_SESSION_ID, sceneId: CINEMA_TEST_SCENE_A }

describe('studio cinema response identity', () => {
  it('accepts a payload whose Scene, records and messages all belong to the identity', () => {
    const snapshot = createTestSceneSnapshot(CINEMA_TEST_SESSION_ID, CINEMA_TEST_SCENE_A, {
      runs: [createTestRun(CINEMA_TEST_SCENE_A, 'run_a', 'running')],
      renders: [createTestRender(CINEMA_TEST_SCENE_A, 'render_a', { status: 'queued' })],
      messages: [
        {
          id: 'message_a',
          sessionId: CINEMA_TEST_SESSION_ID,
          sceneId: CINEMA_TEST_SCENE_A,
          role: 'assistant',
          agent: 'builder',
          parts: [
            { id: 'part_1', messageId: 'message_a', sessionId: CINEMA_TEST_SESSION_ID, type: 'text', text: 'hi' },
          ],
          createdAt: '2026-03-22T00:00:00.000Z',
          updatedAt: '2026-03-22T00:00:00.000Z',
        },
      ],
    })

    expect(isStudioCinemaSceneSnapshotForIdentity(IDENTITY_A, snapshot)).toBe(true)
    expect(
      isStudioCinemaAcceptedRunResponseForIdentity(IDENTITY_A, {
        ...snapshot,
        run: createTestRun(CINEMA_TEST_SCENE_A, 'run_a', 'running'),
      }),
    ).toBe(true)
  })

  it('refuses a foreign Scene, a foreign Session and a Legacy record without sceneId', () => {
    expect(
      isStudioCinemaSceneSnapshotForIdentity(
        IDENTITY_A,
        createTestSceneSnapshot(CINEMA_TEST_SESSION_ID, CINEMA_TEST_SCENE_B),
      ),
    ).toBe(false)
    expect(
      isStudioCinemaSceneSnapshotForIdentity(
        IDENTITY_A,
        createTestSceneSnapshot('session_other', CINEMA_TEST_SCENE_A),
      ),
    ).toBe(false)
    expect(isStudioCinemaScopedRecordForIdentity(IDENTITY_A, { sessionId: CINEMA_TEST_SESSION_ID })).toBe(false)
    expect(
      isStudioCinemaScopedRecordForIdentity(IDENTITY_A, {
        sessionId: CINEMA_TEST_SESSION_ID,
        sceneId: CINEMA_TEST_SCENE_B,
      }),
    ).toBe(false)
  })

  it('refuses a message from another Scene, another Session or with a mismatched part', () => {
    const message = {
      id: 'message_a',
      sessionId: CINEMA_TEST_SESSION_ID,
      sceneId: CINEMA_TEST_SCENE_B,
      role: 'user' as const,
      text: 'hello',
      createdAt: '2026-03-22T00:00:00.000Z',
      updatedAt: '2026-03-22T00:00:00.000Z',
    }
    const snapshot = (messages: unknown[]) =>
      createTestSceneSnapshot(CINEMA_TEST_SESSION_ID, CINEMA_TEST_SCENE_A, {
        messages: messages as never,
      })

    expect(isStudioCinemaSceneSnapshotForIdentity(IDENTITY_A, snapshot([message]))).toBe(false)
    expect(isStudioCinemaSceneSnapshotForIdentity(IDENTITY_A, snapshot([{ ...message, sceneId: undefined }]))).toBe(
      true,
    )
    expect(
      isStudioCinemaSceneSnapshotForIdentity(IDENTITY_A, snapshot([{ ...message, sceneId: undefined, sessionId: 'other' }])),
    ).toBe(false)
    expect(
      isStudioCinemaSceneSnapshotForIdentity(
        IDENTITY_A,
        snapshot([
          {
            ...message,
            sceneId: undefined,
            role: 'assistant',
            agent: 'builder',
            parts: [{ id: 'p', messageId: 'other', sessionId: CINEMA_TEST_SESSION_ID, type: 'text', text: 'x' }],
          },
        ]),
      ),
    ).toBe(false)
  })
})
