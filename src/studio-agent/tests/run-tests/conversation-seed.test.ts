import assert from 'node:assert/strict'
import { createInMemoryStudioPersistence } from '../../infrastructure/persistence/in-memory-studio-persistence'
import { createStudioUserMessage } from '../../domain/factories'
import { createStudioSessionService } from '../../runtime/session-service'
import { run } from './factories'

/**
 * The client data shape (`STUDIO_DATA_MODE=client`) keeps the transcript in the browser and replays it
 * when a Run needs context. These specifications pin the three properties the server side must hold:
 * the replay lands in order, the assistant text lands where the loop reads it back, and a history the
 * server already has is never overwritten — so a replay that runs twice cannot duplicate a Session.
 */
const workspaceProvider = {
  kind: 'local' as const,
  requiresDirectoryAccess: false,
  normalizeDirectory: (directory: string) => directory,
}

export async function runConversationSeedTests(): Promise<void> {
  await run('a replayed conversation is stored in order, with the reply text where the loop reads it', async () => {
    const persistence = createInMemoryStudioPersistence()
    const service = createStudioSessionService({ persistence, workspaceProvider })

    const inserted = await service.seedConversation({
      sessionId: 'sess_seed',
      conversation: [
        { role: 'user', text: '画一个圆' },
        { role: 'assistant', text: '好的，先画圆。' },
        { role: 'user', text: '再让它变成方形' },
      ],
    })

    assert.equal(inserted, 3)

    const messages = await persistence.messageStore.listBySessionId('sess_seed')
    assert.deepEqual(messages.map((message) => message.role), ['user', 'assistant', 'user'])

    const [first, second, third] = messages
    assert.equal(first.role === 'user' ? first.text : null, '画一个圆')
    assert.equal(third.role === 'user' ? third.text : null, '再让它变成方形')

    // Order is what the model reads, so it must be strict even when everything lands in one millisecond.
    assert.equal(first.createdAt < second.createdAt, true)
    assert.equal(second.createdAt < third.createdAt, true)

    const assistant = second.role === 'assistant' ? second : null
    assert.ok(assistant, 'the second seeded message is the assistant reply')
    assert.deepEqual(assistant.metadata?.providerMessage, { content: '好的，先画圆。' })
  })

  await run('a second replay is a no-op, never a duplicated transcript', async () => {
    const persistence = createInMemoryStudioPersistence()
    const service = createStudioSessionService({ persistence, workspaceProvider })

    const conversation = [
      { role: 'user' as const, text: '画一个圆' },
      { role: 'assistant' as const, text: '好的，先画圆。' },
    ]

    assert.equal(await service.seedConversation({ sessionId: 'sess_seed', conversation }), 2)
    assert.equal(await service.seedConversation({ sessionId: 'sess_seed', conversation }), 0)

    const messages = await persistence.messageStore.listBySessionId('sess_seed')
    assert.equal(messages.length, 2)
  })

  await run('a history the server already holds is never overwritten', async () => {
    const persistence = createInMemoryStudioPersistence()
    const service = createStudioSessionService({ persistence, workspaceProvider })

    await persistence.messageStore.createUserMessage(
      createStudioUserMessage({ sessionId: 'sess_known', text: '服务端已有的第一句' })
    )

    const inserted = await service.seedConversation({
      sessionId: 'sess_known',
      conversation: [{ role: 'user', text: '浏览器以为的第一句' }],
    })

    assert.equal(inserted, 0)

    const messages = await persistence.messageStore.listBySessionId('sess_known')
    assert.equal(messages.length, 1)
    assert.equal(messages[0].role === 'user' ? messages[0].text : null, '服务端已有的第一句')
  })
}
