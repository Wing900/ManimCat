import assert from 'node:assert/strict'
import {
  createStudioAssistantMessage,
  createStudioRender,
  createStudioRun,
  createStudioScene,
  createStudioSession,
  createStudioTextPart,
} from '../../domain/factories'
import { createInMemoryStudioPersistence } from '../../infrastructure/persistence/in-memory-studio-persistence'
import { run } from './factories'

const OWNER = 'owner_delete'

/**
 * Deleting a Session is the only delete a store offers, and everything that points at the Session has to
 * go with it: the Supabase schema does that with `on delete cascade`, and the in-memory stores have no
 * foreign keys at all, so this also pins the cascade that the persistence factory wires by hand.
 */
export async function runSessionDeleteTests(): Promise<void> {
  await run('deleting a Session removes its Scenes, messages, parts, Runs and renders', async () => {
    const persistence = createInMemoryStudioPersistence()
    const session = await persistence.sessionStore.create(
      createStudioSession({
        studioKind: 'manim',
        ownerId: OWNER,
        projectId: 'project_delete',
        agentType: 'builder',
        title: 'Delete me',
        directory: 'manim-studio/delete-me',
      }),
    )
    const scene = await persistence.sceneStore.create(
      createStudioScene({
      id: 'scene_1',
      ownerId: OWNER,
      sessionId: session.id,
      position: 0,
      sourcePath: 'scene.py'
    }),
    )
    const message = await persistence.messageStore.createAssistantMessage(
      createStudioAssistantMessage({ sessionId: session.id, agent: 'builder' }),
    )
    await persistence.partStore.create(
      createStudioTextPart({ messageId: message.id, sessionId: session.id, text: 'hello' }),
    )
    await persistence.runStore.create(
      createStudioRun({
        ownerId: OWNER,
        sessionId: session.id,
        sceneId: scene.id,
        inputText: 'run',
        activeAgent: 'builder',
      }),
    )
    await persistence.renderStore.create(
      createStudioRender({
        ownerId: OWNER,
        sessionId: session.id,
        sceneId: scene.id,
        kind: 'manim',
        title: 'Render',
        concept: 'a circle',
        outputMode: 'video',
      }),
    )

    assert.equal(await persistence.sessionStore.delete(OWNER, session.id), true)

    assert.equal(await persistence.sessionStore.getById(OWNER, session.id), null)
    assert.deepEqual(await persistence.sceneStore.listBySessionId(OWNER, session.id), [])
    assert.deepEqual(await persistence.messageStore.listBySessionId(session.id), [])
    assert.deepEqual(await persistence.partStore.listByMessageId(message.id), [])
    assert.deepEqual(await persistence.runStore.listBySessionId(OWNER, session.id), [])
    assert.deepEqual(await persistence.renderStore.listBySessionId(OWNER, session.id), [])
  })

  await run('a delete is scoped to its owner and answers false for anything else', async () => {
    const persistence = createInMemoryStudioPersistence()
    const session = await persistence.sessionStore.create(
      createStudioSession({
        studioKind: 'manim',
        ownerId: OWNER,
        projectId: 'project_delete',
        agentType: 'builder',
        title: 'Not yours',
        directory: 'manim-studio/not-yours',
      }),
    )

    // Another owner cannot delete it, and the refused attempt leaves it exactly where it was…
    assert.equal(await persistence.sessionStore.delete('owner_other', session.id), false)
    assert.notEqual(await persistence.sessionStore.getById(OWNER, session.id), null)
    // …and an id that never existed is not an error either.
    assert.equal(await persistence.sessionStore.delete(OWNER, 'session_missing'), false)
  })
}
