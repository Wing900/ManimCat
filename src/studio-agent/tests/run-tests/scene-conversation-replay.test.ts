import assert from 'node:assert/strict'
import type { Response } from 'express'
import { createInMemoryStudioPersistence } from '../../infrastructure/persistence/in-memory-studio-persistence'
import {
  createStudioRun,
  createStudioScene,
  createStudioSession,
  createStudioUserMessage
} from '../../domain/factories'
import { createStudioSessionService } from '../../runtime/session-service'
import { listStudioMessagesForRun } from '../../runs/message-selection'
import { handleStudioSceneRunRequest } from '../../../routes/helpers/studio-agent-scene-handlers'
import type { StudioSceneRouteDependencies } from '../../../routes/helpers/studio-agent-scene-handlers'
import { run } from './factories'

const workspaceProvider = {
  kind: 'local' as const,
  requiresDirectoryAccess: false,
  normalizeDirectory: (directory: string) => directory
}

function fixture() {
  const session = createStudioSession({
    ownerId: 'owner-round2',
    projectId: 'project-round2',
    studioKind: 'manim',
    agentType: 'builder',
    title: 'Round 2 replay',
    directory: '/tmp/round2'
  })
  const sceneA = createStudioScene({
    ownerId: session.ownerId,
    sessionId: session.id,
    position: 0,
    sourcePath: '/tmp/round2/scenes/a.py',
    id: 'scene_round2_a'
  })
  const sceneB = createStudioScene({
    ownerId: session.ownerId,
    sessionId: session.id,
    position: 1,
    sourcePath: '/tmp/round2/scenes/b.py',
    id: 'scene_round2_b'
  })
  return { session, sceneA, sceneB }
}

function fakeResponse() {
  const state = { status: 0, body: undefined as unknown }
  const response = {
    status(code: number) {
      state.status = code
      return response
    },
    json(body: unknown) {
      state.body = body
      return response
    }
  }
  return { response: response as unknown as Response, state }
}

export async function runSceneConversationReplayTests(): Promise<void> {
  await run('authorized Scene run seeds the replay into that Scene only', async () => {
    const { session, sceneA } = fixture()
    const persistence = createInMemoryStudioPersistence()
    const service = createStudioSessionService({ persistence, workspaceProvider })
    const seedCalls: Array<Parameters<StudioSceneRouteDependencies['seedConversation']>[0]> = []
    const startCalls: Array<Parameters<StudioSceneRouteDependencies['startRun']>[0]> = []
    const { response, state } = fakeResponse()

    const deps = {
      getScene: async (_ownerId: string, sceneId: string) => sceneId === sceneA.id ? sceneA : null,
      getSession: async (_ownerId: string, sessionId: string) => sessionId === session.id ? session : null,
      getSceneSnapshot: async () => null,
      startRun: async (input: Parameters<StudioSceneRouteDependencies['startRun']>[0]) => {
        startCalls.push(input)
        return { status: 'not_found' as const }
      },
      seedConversation: async (input: Parameters<StudioSceneRouteDependencies['seedConversation']>[0]) => {
        seedCalls.push(input)
        return service.seedConversation(input)
      },
      subscribeExternalEvents: () => undefined,
      openEventStream: () => undefined,
      resolveEffectiveCustomApiConfig: () => ({
        routeByManimcatKey: false,
        hasUsableCustomApiConfig: false
      })
    } as unknown as StudioSceneRouteDependencies

    await handleStudioSceneRunRequest({
      res: response,
      ownerId: session.ownerId,
      mode: 'byok',
      sessionId: session.id,
      sceneId: sceneA.id,
      body: {
        inputText: 'continue this scene',
        conversation: [
          { role: 'user', text: 'browser owned question' },
          { role: 'assistant', text: 'browser owned answer' }
        ]
      },
      deps
    })

    assert.equal(seedCalls.length, 1)
    assert.equal(seedCalls[0]?.sessionId, session.id)
    assert.equal(seedCalls[0]?.sceneId, sceneA.id)
    assert.deepEqual(seedCalls[0]?.conversation.map((entry) => entry.text), [
      'browser owned question',
      'browser owned answer'
    ])
    assert.equal(startCalls[0]?.sceneId, sceneA.id)
    // The handler mapped startRun's not_found to its public error after the seed ran.
    assert.equal(state.status, 404)
  })

  await run('replay is idempotent per Scene and a Scene Run sees only its own history', async () => {
    const { session, sceneA, sceneB } = fixture()
    const persistence = createInMemoryStudioPersistence()
    const service = createStudioSessionService({ persistence, workspaceProvider })

    // A sibling Scene already holds history: it must not suppress this Scene's replay.
    await persistence.messageStore.createUserMessage(createStudioUserMessage({
      sessionId: session.id,
      sceneId: sceneB.id,
      text: 'sibling history'
    }))
    await persistence.messageStore.createUserMessage(createStudioUserMessage({
      sessionId: session.id,
      text: 'legacy history'
    }))

    const inserted = await service.seedConversation({
      sessionId: session.id,
      sceneId: sceneA.id,
      conversation: [
        { role: 'user', text: 'scene A question' },
        { role: 'assistant', text: 'scene A answer' },
        { role: 'user', text: 'scene A follow-up' }
      ],
      agentType: 'builder'
    })
    assert.equal(inserted, 3)
    const sceneMessages = await persistence.messageStore.listBySceneId(sceneA.id)
    assert.deepEqual(sceneMessages.map((message) => message.role), ['user', 'assistant', 'user'])
    assert.ok(sceneMessages.every((message) => message.sceneId === sceneA.id))
    const assistant = sceneMessages[1]
    assert.ok(assistant && assistant.role === 'assistant')
    assert.deepEqual(assistant.metadata?.providerMessage, { content: 'scene A answer' })

    // A second replay of the same Scene is a no-op, while the sibling still does not block it.
    assert.equal(await service.seedConversation({
      sessionId: session.id,
      sceneId: sceneA.id,
      conversation: [{ role: 'user', text: 'must not duplicate' }]
    }), 0)
    assert.equal((await persistence.messageStore.listBySceneId(sceneA.id)).length, 3)

    const runA = createStudioRun({
      ownerId: session.ownerId,
      sessionId: session.id,
      sceneId: sceneA.id,
      inputText: 'next step',
      activeAgent: 'builder'
    })
    const seenBySceneRun = await listStudioMessagesForRun({
      messageStore: persistence.messageStore,
      run: runA
    })
    const seenText = seenBySceneRun.map((message) =>
      message.role === 'user' ? message.text : message.role)
    assert.deepEqual(seenText, ['scene A question', 'assistant', 'scene A follow-up'])
    assert.equal(JSON.stringify(seenBySceneRun).includes('sibling history'), false)
    assert.equal(JSON.stringify(seenBySceneRun).includes('legacy history'), false)

    // Another Scene's replay receives its own scope, not A's rows.
    assert.equal(await service.seedConversation({
      sessionId: session.id,
      sceneId: 'scene_round2_other',
      conversation: [{ role: 'user', text: 'other scene question' }]
    }), 1)
    assert.deepEqual(
      (await persistence.messageStore.listBySceneId('scene_round2_other')).map((message) =>
        message.role === 'user' ? message.text : message.role),
      ['other scene question']
    )
  })
}
