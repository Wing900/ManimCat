import assert from 'node:assert/strict'
import {
  createStudioPrincipal,
  createStudioRun,
  createStudioSession,
  InMemoryStudioRunStore,
  InMemoryStudioSessionStore,
} from '../../index'
import { parseStudioCreateSessionRequest } from '../../../routes/helpers/studio-agent-run-request'
import { run } from './factories'

export async function runSecurityTests(): Promise<void> {
  await run('studio principal does not expose the raw API key', async () => {
    const principal = createStudioPrincipal('secret-api-key')
    assert.equal(principal.ownerId.length, 32)
    assert.equal('secret-api-key' in principal, false)
    assert.deepEqual(principal, createStudioPrincipal('secret-api-key'))
    assert.notEqual(principal.ownerId, createStudioPrincipal('another-api-key').ownerId)
  })

  await run('session and run stores isolate owners', async () => {
    const sessionStore = new InMemoryStudioSessionStore()
    const runStore = new InMemoryStudioRunStore()
    const session = createStudioSession({
      ownerId: 'owner-a',
      projectId: 'project',
      agentType: 'builder',
      title: 'Owner A',
      directory: 'workspace-a',
      permissionLevel: 'L4',
    })
    const runRecord = createStudioRun({
      ownerId: session.ownerId,
      sessionId: session.id,
      inputText: 'draw',
      activeAgent: 'builder',
    })

    await sessionStore.create(session)
    await runStore.create(runRecord)

    assert.equal(await sessionStore.getById('owner-b', session.id), null)
    assert.equal(await runStore.getById('owner-b', runRecord.id), null)
    assert.ok(await sessionStore.getById('owner-a', session.id))
    assert.ok(await runStore.getById('owner-a', runRecord.id))
  })

  await run('session creation rejects client supplied directories', async () => {
    assert.throws(
      () => parseStudioCreateSessionRequest({ projectId: 'project', directory: 'C:\\outside' }),
      /Unrecognized key: "directory"/
    )
  })
}
