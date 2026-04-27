import { getDefaultStudioWorkspacePath } from '../../workspace/default-studio-workspace'
import path from 'node:path'
import os from 'node:os'
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import {
  createStudioSkillRuntime,
  createStudioDefaultTurnPlanResolver,
  createPlaceholderStudioTools,
  createLocalStudioSkillResolver,
  InMemoryStudioEventBus,
  InMemoryStudioMessageStore,
  InMemoryStudioPartStore,
  InMemoryStudioRunStore,
  InMemoryStudioSessionEventStore,
  InMemoryStudioSessionStore,
  InMemoryStudioTaskStore,
  InMemoryStudioWorkResultStore,
  InMemoryStudioWorkStore,
  StudioBuilderRuntime,
  StudioToolRegistry,
  type StudioAssistantMessage,
  type StudioRuntimeBackedToolContext,
  type StudioTurnPlanResolver
} from '../../index'
import type { StudioSession, StudioRun, StudioTask, StudioToolPart, StudioAssistantMessage as StudioAssistantMessageType } from '../../index'

export function createTestRuntime(options?: {
  resolveTurnPlan?: StudioTurnPlanResolver
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
  const taskStore = new InMemoryStudioTaskStore()
  const sessionEventStore = new InMemoryStudioSessionEventStore()
  const workStore = new InMemoryStudioWorkStore()
  const workResultStore = new InMemoryStudioWorkResultStore()
  const resolveSkill = createLocalStudioSkillResolver()
  const resolveTurnPlan = options?.resolveTurnPlan ?? createStudioDefaultTurnPlanResolver({ registry })

  const runtime = new StudioBuilderRuntime({
    registry,
    messageStore,
    partStore,
    runStore,
    sessionStore,
    sessionEventStore,
    taskStore,
    workStore,
    workResultStore,
    resolveSkill,
    resolveTurnPlan,
    eventBus: options?.eventBus
  })

  return {
    registry,
    runtime,
    messageStore,
    partStore,
    runStore,
    sessionStore,
    sessionEventStore,
    taskStore,
    workStore,
    workResultStore,
    resolveTurnPlan
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
