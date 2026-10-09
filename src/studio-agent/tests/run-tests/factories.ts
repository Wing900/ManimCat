import { getDefaultStudioWorkspacePath } from '../../workspace/default-studio-workspace'
import path from 'node:path'
import os from 'node:os'
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import {
  createPlaceholderStudioTools,
  InMemoryStudioEventBus,
  InMemoryStudioMessageStore,
  InMemoryStudioPartStore,
  InMemoryStudioRunStore,
  InMemoryStudioSessionStore,
  StudioBuilderRuntime,
  StudioToolRegistry,
  type StudioAssistantMessage,
  type StudioRuntimeBackedToolContext,
  type StudioStaticCheckPort
} from '../../index'
import type { StudioSession, StudioRun, StudioToolPart, StudioAssistantMessage as StudioAssistantMessageType } from '../../index'

export function createTestRuntime(options?: {
  eventBus?: InMemoryStudioEventBus
}) {
  const registry = new StudioToolRegistry()
  for (const tool of createPlaceholderStudioTools()) {
    registry.register(tool)
  }

  const messageStore = new InMemoryStudioMessageStore()
  const partStore = new InMemoryStudioPartStore()
  const runStore = new InMemoryStudioRunStore()
  const sessionStore = new InMemoryStudioSessionStore()

  const runtime = new StudioBuilderRuntime({
    registry,
    messageStore,
    partStore,
    runStore,
    eventBus: options?.eventBus
  })

  return {
    registry,
    runtime,
    messageStore,
    partStore,
    runStore,
    sessionStore
  }
}

export async function createWorkspace(): Promise<string> {
  return mkdtemp(path.join(os.tmpdir(), 'manimcat-studio-agent-'))
}

export async function run(name: string, fn: () => Promise<void>) {
  try {
    await fn()
    console.log(`PASS ${name}`)
  } catch (error) {
    console.error(`FAIL ${name}`)
    throw error
  }
}

export async function findLastAssistantMessageWithTool(messageStore: InMemoryStudioMessageStore, sessionId: string): Promise<StudioAssistantMessage | undefined> {
  const messages = await messageStore.listBySessionId(sessionId)
  return [...messages]
    .reverse()
    .find((message): message is StudioAssistantMessage => message.role === 'assistant' && message.parts.some((part) => part.type === 'tool'))
}

/**
 * A check Port that always passes.
 *
 * The render Tools gate on a static check before they reserve anything, and that Port is injected
 * rather than defaulted: an unconfigured Port fails loudly, so every test that exercises a render
 * Tool states its check outcome explicitly.
 */
export function createPassingStudioStaticCheckPort(): StudioStaticCheckPort {
  return {
    async check(request) {
      return { kind: request.kind, outputMode: request.outputMode ?? 'video', diagnostics: [] }
    }
  }
}
