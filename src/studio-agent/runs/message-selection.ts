import type { StudioMessage, StudioMessageStore, StudioRun } from '../domain/types'

/**
 * Single selector for the conversation a Run is allowed to see.
 *
 * A Scene Run sees exactly its own Scene messages; a Legacy Run keeps the whole Session history.
 * The scope comes from the persisted Run, never from message metadata, and sibling histories are
 * never merged.
 */
export async function listStudioMessagesForRun(input: {
  messageStore: StudioMessageStore
  run: StudioRun
}): Promise<StudioMessage[]> {
  return selectStudioRunScopeRecords(input.run, {
    bySceneId: (sceneId) => input.messageStore.listBySceneId(sceneId),
    bySessionId: () => input.messageStore.listBySessionId(input.run.sessionId)
  })
}

/**
 * The same scope decision for any other Run-scoped record (renders, assistant messages): a Scene
 * Run reads its Scene, a Legacy Run reads its Session. Kept beside the message selector so
 * finalization, render selection and prompt assembly cannot drift apart.
 */
export async function selectStudioRunScopeRecords<T>(
  run: StudioRun,
  selectors: {
    bySceneId: (sceneId: string) => Promise<T>
    bySessionId: () => Promise<T>
  }
): Promise<T> {
  return run.sceneId ? selectors.bySceneId(run.sceneId) : selectors.bySessionId()
}
