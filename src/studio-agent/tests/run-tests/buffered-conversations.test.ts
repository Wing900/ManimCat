import assert from 'node:assert/strict'
import { createStudioAssistantMessage, createStudioSession, createStudioTextPart, createStudioUserMessage } from '../../domain/factories'
import { withBufferedStudioConversations } from '../../infrastructure/persistence/buffered-studio-conversations'
import { createInMemoryStudioPersistence } from '../../infrastructure/persistence/in-memory-studio-persistence'
import { StudioSessionRunner } from '../../runtime/execution/session-runner/session-runner'
import { StudioToolRegistry } from '../../tools/registry'
import { run } from './factories'

export async function runBufferedConversationTests(): Promise<void> {
  await run('conversation mutations stay in memory until finalization', async () => {
    const durable = createInMemoryStudioPersistence()
    const buffered = withBufferedStudioConversations(durable)
    const scope = { sessionId: 'session', sceneId: 'scene' }
    await buffered.conversationBuffer!.begin(scope)
    const user = createStudioUserMessage({ ...scope, text: 'draw a circle' })
    const assistant = createStudioAssistantMessage({ ...scope, agent: 'builder', notBefore: user.createdAt })
    await buffered.messageStore.createUserMessage(user)
    await buffered.messageStore.createAssistantMessage(assistant)
    const part = createStudioTextPart({ sessionId: scope.sessionId, messageId: assistant.id, type: 'text' })
    await buffered.partStore.create(part)
    await buffered.partStore.update(part.id, { text: 'complete reply' })
    const savedPart = await buffered.partStore.getById(part.id)
    await buffered.messageStore.updateAssistantMessage(assistant.id, { parts: [savedPart!] })
    assert.equal((await durable.messageStore.listBySceneId(scope.sceneId)).length, 0)
    assert.equal((await durable.partStore.listByMessageId(assistant.id)).length, 0)
    const live = await buffered.messageStore.listBySceneId(scope.sceneId)
    assert.deepEqual(live.map(message => message.id), [user.id, assistant.id])
    assert.equal(live[1].role === 'assistant' && live[1].parts[0].type === 'text' && live[1].parts[0].text, 'complete reply')
    await buffered.conversationBuffer!.flush(scope)
    assert.equal((await durable.messageStore.listBySceneId(scope.sceneId)).length, 2)
    assert.equal((await durable.partStore.getById(part.id))?.type, 'text')
    await buffered.conversationBuffer!.flush(scope)
    await buffered.conversationBuffer!.begin(scope)
    await buffered.conversationBuffer!.flush(scope)
  })

  await run('sibling scopes flush independently and preserve persisted history', async () => {
    const durable = createInMemoryStudioPersistence()
    const old = createStudioUserMessage({ sessionId: 'session', sceneId: 'a', text: 'history' })
    await durable.messageStore.createUserMessage(old)
    const buffered = withBufferedStudioConversations(durable)
    for (const sceneId of ['a', 'b']) {
      const scope = { sessionId: 'session', sceneId }
      await buffered.conversationBuffer!.begin(scope)
      await buffered.messageStore.createUserMessage(createStudioUserMessage({ ...scope, text: sceneId }))
    }
    await buffered.conversationBuffer!.flush({ sessionId: 'session', sceneId: 'a' })
    assert.equal((await durable.messageStore.listBySceneId('a')).length, 2)
    assert.equal((await durable.messageStore.listBySceneId('b')).length, 0)
    assert.equal((await buffered.messageStore.listBySceneId('b')).length, 1)
  })

  await run('failed conversation save retains live records and can be retried', async () => {
    const durable = createInMemoryStudioPersistence()
    let attempts = 0
    const buffered = withBufferedStudioConversations({ ...durable, conversationWriter: async messages => {
      attempts++
      if (attempts === 1) throw new Error('offline')
      for (const message of messages) {
        if (message.role === 'user') await durable.messageStore.createUserMessage(message)
      }
    } })
    const scope = { sessionId: 'session', sceneId: 'scene' }
    await buffered.conversationBuffer!.begin(scope)
    const user = createStudioUserMessage({ ...scope, text: 'retry' })
    await buffered.messageStore.createUserMessage(user)
    await assert.rejects(buffered.conversationBuffer!.flush(scope), /offline/)
    assert.equal((await buffered.messageStore.getById(user.id))?.id, user.id)
    await buffered.conversationBuffer!.begin(scope)
    assert.equal((await durable.messageStore.getById(user.id))?.id, user.id)
  })

  await run('task admission returns while preparation is pending; cancellation saves the turn', async () => {
    const durable = createInMemoryStudioPersistence()
    const buffered = withBufferedStudioConversations(durable)
    const session = createStudioSession({ ownerId: 'owner', projectId: 'project', agentType: 'builder', studioKind: 'manim', title: 'Admission', directory: 'workspace' })
    let release: () => void = () => {}
    const ready = new Promise<void>(resolve => { release = resolve })
    const runner = new StudioSessionRunner({
      registry: new StudioToolRegistry(),
      ...buffered,
      renderStore: {
        create: render => buffered.renderStore.create(render),
        getById: (ownerId, id) => buffered.renderStore.getById(ownerId, id),
        update: (ownerId, id, patch) => buffered.renderStore.update(ownerId, id, patch),
        transitionStatus: input => buffered.renderStore.transitionStatus(input),
        listBySceneId: (ownerId, id) => buffered.renderStore.listBySceneId(ownerId, id),
        listBySessionId: async () => { await ready; return [] },
      },
    })
    const handle = await runner.startBackgroundRun({ projectId: 'project', session, inputText: 'hello' })
    assert.equal(handle.run.status, 'running')
    assert.equal((await durable.messageStore.listBySessionId(session.id)).length, 0)
    handle.abort('cancelled during preparation')
    release()
    await assert.rejects(handle.completion, /cancelled during preparation/)
    assert.equal((await durable.messageStore.listBySessionId(session.id)).length, 2)
    assert.equal((await durable.runStore.getById(session.ownerId, handle.run.id))?.status, 'cancelled')
  })
}
