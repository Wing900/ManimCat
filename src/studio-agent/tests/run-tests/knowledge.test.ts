import assert from 'node:assert/strict'
import {
  buildStudioAgentSystemPrompt,
  createDefaultStudioKnowledgeProvider,
  createInMemoryStudioPersistence,
  createLocalStudioWorkspaceProvider,
  createStudioAssistantMessage,
  createStudioRun,
  createStudioSession,
  createStudioRuntimeService,
  createUnavailableStudioKnowledgeProvider,
  InMemoryStudioEventBus,
  lookupStudioKnowledge,
  ManimKnowledgeAdapter,
  MATPLOTLIB_KNOWLEDGE_SOURCE,
  STUDIO_KNOWLEDGE_LIMITS,
  STUDIO_KNOWLEDGE_LOOKUP_SOURCE,
  StudioKnowledgeRouter,
  type StudioKnowledgeProvider,
  type StudioKnowledgeRequest,
  type StudioKnowledgeResult,
  type StudioKnowledgeStatus,
  type StudioRuntimeBackedToolContext,
} from '../../index'
import { configureStudioToolRegistry } from '../../runtime/studio-tool-registry'
import { createSharedStudioTools } from '../../shared/register-shared-tools'
import type { ManimApiProvider, ManimApiRequest, ManimApiResult } from '../../../services/manim-api'
import { createWorkspace, run } from './factories'

export async function runKnowledgeTests(): Promise<void> {
  await run('router selects the Manim adapter for a Manim request', async () => {
    const seen: StudioKnowledgeRequest[] = []
    const manimAdapter: StudioKnowledgeProvider = {
      async lookup(request) {
        seen.push(request)
        return {
          status: 'found',
          source: 'fake-manim',
          query: request.query,
          symbols: request.symbols,
          content: 'Status: FOUND\nclass Axes',
          cached: false,
          truncated: false
        }
      }
    }
    const router = new StudioKnowledgeRouter({ adapters: { manim: manimAdapter } })

    const found = await lookupStudioKnowledge(router, {
      kind: 'manim',
      query: 'Axes',
      symbols: ['Axes'],
      maxChars: 1000
    })

    assert.equal(found.status, 'found')
    assert.equal(found.source, 'fake-manim')
    assert.match(found.content, /class Axes/)
    assert.equal(seen.length, 1)
    assert.equal(seen[0]?.kind, 'manim')
    assert.deepEqual(seen[0]?.symbols, ['Axes'])

    await lookupStudioKnowledge(router, {
      kind: 'plot',
      query: 'Axes',
      symbols: [],
      maxChars: 1000
    })
    assert.equal(seen.length, 1, 'the Manim adapter must not answer Plot requests')
  })

  await run('missing Plot adapter yields an explicit unavailable result', async () => {
    const router = new StudioKnowledgeRouter({
      adapters: {
        manim: createUnavailableStudioKnowledgeProvider({ source: 'unused' })
      }
    })

    const result = await lookupStudioKnowledge(router, {
      kind: 'plot',
      query: 'matplotlib figure sizing',
      symbols: ['Figure'],
      maxChars: 1000
    })

    assert.equal(result.status, 'unavailable')
    assert.ok(result.content.length > 0, 'unavailable must never be a silent empty string')
    assert.match(result.content, /Status: UNAVAILABLE/)
    assert.match(result.content, /Do not invent an API/)
    assert.deepEqual(result.symbols, ['Figure'])
    assert.equal(result.cached, false)
    assert.equal(result.truncated, false)

    // 04B wires a real Matplotlib adapter into the production composition, so the
    // injection seam is exercised here instead of calling the real Plot lookup.
    const productionPlot = await lookupStudioKnowledge(createDefaultStudioKnowledgeProvider({
      plotKnowledgeProvider: {
        async lookup(request) {
          return {
            status: 'found',
            source: MATPLOTLIB_KNOWLEDGE_SOURCE,
            query: request.query,
            symbols: request.symbols,
            content: 'Status: FOUND\nclass matplotlib.figure.Figure',
            cached: false,
            truncated: false
          }
        }
      }
    }), {
      kind: 'plot',
      query: 'matplotlib figure sizing',
      symbols: [],
      maxChars: 1000
    })
    assert.equal(productionPlot.status, 'found')
    assert.equal(productionPlot.source, MATPLOTLIB_KNOWLEDGE_SOURCE)
  })

  await run('provider failure yields a bounded structured unavailable result', async () => {
    const exploding: StudioKnowledgeProvider = {
      async lookup() {
        throw new Error('catalog exploded at /opt/manim/secret with token=abc123')
      }
    }

    const result = await lookupStudioKnowledge(exploding, {
      kind: 'manim',
      query: 'Axes',
      symbols: [],
      maxChars: 40
    })

    assert.equal(result.status, 'unavailable')
    assert.equal(result.truncated, false)
    assert.ok(result.content.length > 0)
    assert.ok(result.content.length <= STUDIO_KNOWLEDGE_LIMITS.minContentChars)
    assert.match(result.content, /Status: UNAVAILABLE/)
    assert.match(result.content, /Do not invent an API/)
    assert.ok(!result.content.includes('exploded'), 'raw error text must not leak')
    assert.ok(!result.content.includes('/opt/manim'), 'host paths must not leak')
    assert.ok(!result.content.includes('token=abc123'), 'credentials must not leak')
  })

  await run('request normalization bounds query, symbols, and output size', async () => {
    const captured: StudioKnowledgeRequest[] = []
    const provider: StudioKnowledgeProvider = {
      async lookup(request) {
        captured.push(request)
        return {
          status: 'found',
          source: 'fake',
          query: request.query,
          symbols: request.symbols,
          content: 'x'.repeat(20_000),
          cached: false,
          truncated: false
        }
      }
    }

    const result = await lookupStudioKnowledge(provider, {
      kind: 'manim',
      query: `  ${'q'.repeat(700)}  `,
      symbols: Array.from({ length: 20 }, (_, index) => ` symbol-${index}-${'s'.repeat(200)} `),
      maxChars: 99_999
    })

    assert.equal(captured.length, 1)
    const sent = captured[0]!
    assert.equal(sent.query.length, STUDIO_KNOWLEDGE_LIMITS.maxQueryChars)
    assert.ok(!sent.query.startsWith(' '), 'the query must be trimmed')
    assert.equal(sent.symbols.length, STUDIO_KNOWLEDGE_LIMITS.maxSymbols)
    assert.ok(sent.symbols.every((symbol) => symbol.length === STUDIO_KNOWLEDGE_LIMITS.maxSymbolChars))
    assert.equal(sent.maxChars, STUDIO_KNOWLEDGE_LIMITS.maxContentChars)

    assert.equal(result.content.length, STUDIO_KNOWLEDGE_LIMITS.maxContentChars)
    assert.equal(result.truncated, true)
    assert.equal(result.query.length, STUDIO_KNOWLEDGE_LIMITS.maxQueryChars)
    assert.equal(result.symbols.length, STUDIO_KNOWLEDGE_LIMITS.maxSymbols)

    await lookupStudioKnowledge(provider, { kind: 'plot', query: 'x', symbols: [], maxChars: 10 })
    assert.equal(captured[1]?.maxChars, STUDIO_KNOWLEDGE_LIMITS.minContentChars)

    await lookupStudioKnowledge(provider, { kind: 'plot', query: 'x', symbols: ['  ', 'Figure'], maxChars: 500 })
    assert.deepEqual(captured[2]?.symbols, ['Figure'])
  })

  await run('Manim adapter maps found, not_found, and unavailable faithfully', async () => {
    const calls: ManimApiRequest[] = []
    const provider = createFakeManimApiProvider(async (request) => {
      calls.push(request)
      return {
        status: 'found',
        query: request.query,
        symbols: request.symbols,
        content: 'Status: FOUND\nclass Axes(Scene)',
        cached: true
      }
    })

    const found = await lookupStudioKnowledge(new ManimKnowledgeAdapter(provider), {
      kind: 'manim',
      query: '  Axes  ',
      symbols: ['Axes'],
      maxChars: 1000
    })
    assert.equal(found.status, 'found')
    assert.equal(found.source, 'manim-runtime-catalog')
    assert.equal(found.cached, true)
    assert.equal(found.query, 'Axes')
    assert.match(found.content, /class Axes/)
    assert.deepEqual(calls, [{ query: 'Axes', symbols: ['Axes'] }], 'the adapter must receive the normalized request')

    const missing = await lookupStudioKnowledge(new ManimKnowledgeAdapter(createFakeManimApiProvider(async (request) => ({
      status: 'not_found',
      query: request.query,
      symbols: request.symbols,
      content: 'Status: NOT_FOUND\nNo matching runtime symbol.',
      cached: false
    }))), { kind: 'manim', query: 'NotAThing', symbols: [], maxChars: 1000 })
    assert.equal(missing.status, 'not_found')
    assert.notEqual(missing.status, 'found')
    assert.match(missing.content, /No matching runtime symbol/)

    const unavailable = await lookupStudioKnowledge(new ManimKnowledgeAdapter(createFakeManimApiProvider(async (request) => ({
      status: 'unavailable',
      query: request.query,
      symbols: request.symbols,
      content: 'Traceback: C:\\Users\\secret\\python.exe exploded',
      cached: false
    }))), { kind: 'manim', query: 'Axes', symbols: [], maxChars: 1000 })
    assert.equal(unavailable.status, 'unavailable')
    assert.match(unavailable.content, /Status: UNAVAILABLE/)
    assert.ok(!unavailable.content.includes('Traceback'), 'the catalog failure text must be replaced')
    assert.ok(!unavailable.content.includes('secret'))
  })

  await run('unavailable and invalid provider results are sanitized', async () => {
    const rawContent = 'Traceback: /opt/manim/secret/python exploded token=secret'

    const unavailable = await lookupStudioKnowledge(fakeProviderReturning({
      status: 'unavailable',
      source: 'manim-runtime-catalog',
      query: 'ignored',
      symbols: [],
      content: rawContent,
      cached: true,
      truncated: false
    }), { kind: 'manim', query: '  Axes  ', symbols: ['Axes'], maxChars: 1000 })

    assert.equal(unavailable.status, 'unavailable')
    assert.equal(unavailable.source, 'manim-runtime-catalog')
    assert.equal(unavailable.query, 'Axes')
    assert.deepEqual(unavailable.symbols, ['Axes'])
    assert.equal(unavailable.cached, false)
    assert.equal(unavailable.truncated, false)
    assert.match(unavailable.content, /Status: UNAVAILABLE/)
    assert.ok(!unavailable.content.includes('Traceback'), 'raw process output must not leak')
    assert.ok(!unavailable.content.includes('token=secret'), 'credentials must not leak')
    assert.ok(!unavailable.content.includes('/opt/manim'), 'host paths must not leak')

    const invalid = await lookupStudioKnowledge(fakeProviderReturning({
      status: 'weird' as StudioKnowledgeStatus,
      source: '../../etc/passwd',
      query: 'ignored',
      symbols: [],
      content: rawContent,
      cached: true,
      truncated: true
    }), { kind: 'manim', query: 'Axes', symbols: [], maxChars: 1000 })

    assert.equal(invalid.status, 'unavailable')
    assert.equal(invalid.source, STUDIO_KNOWLEDGE_LOOKUP_SOURCE)
    assert.equal(invalid.cached, false)
    assert.equal(invalid.truncated, false)
    assert.match(invalid.content, /Status: UNAVAILABLE/)
    assert.ok(!invalid.content.includes('Traceback'))
    assert.ok(!invalid.content.includes('/etc/passwd'))
  })

  await run('empty normalized lookup never reaches the adapter', async () => {
    let calls = 0
    const provider: StudioKnowledgeProvider = {
      async lookup(request) {
        calls += 1
        return {
          status: 'found',
          source: 'fake',
          query: request.query,
          symbols: request.symbols,
          content: 'Status: FOUND',
          cached: false,
          truncated: false
        }
      }
    }

    const result = await lookupStudioKnowledge(provider, {
      kind: 'manim',
      query: '   ',
      symbols: ['  '],
      maxChars: 1000
    })

    assert.equal(calls, 0, 'an empty lookup must not reach the adapter')
    assert.equal(result.status, 'unavailable')
    assert.match(result.content, /Status: UNAVAILABLE/)
    assert.equal(result.query, '')
    assert.deepEqual(result.symbols, [])
    assert.equal(result.truncated, false)
  })

  await run('lookup-api derives the Studio kind from Tool Context', async () => {
    const captured: StudioKnowledgeRequest[] = []
    const provider: StudioKnowledgeProvider = {
      async lookup(request) {
        captured.push(request)
        return {
          status: 'found',
          source: 'fake',
          query: request.query,
          symbols: request.symbols,
          content: 'Status: FOUND',
          cached: false,
          truncated: false
        }
      }
    }
    const lookupTool = createSharedStudioTools(provider).find((tool) => tool.name === 'lookup-api')
    assert.ok(lookupTool, 'lookup-api must be part of the shared tool set')

    await lookupTool.execute({ query: 'figure sizing' }, createToolContext('plot'))
    await lookupTool.execute({ query: 'scene play' }, createToolContext('manim'))

    assert.deepEqual(captured.map((request) => request.kind), ['plot', 'manim'])
  })

  await run('lookup-api returns status metadata with a bounded output', async () => {
    const provider: StudioKnowledgeProvider = {
      async lookup(request) {
        return {
          status: 'found',
          source: 'fake-catalog',
          query: request.query,
          symbols: request.symbols,
          content: 'y'.repeat(9_000),
          cached: true,
          truncated: false
        }
      }
    }
    const lookupTool = createSharedStudioTools(provider).find((tool) => tool.name === 'lookup-api')!

    const result = await lookupTool.execute({ query: 'Axes', symbols: ['Axes'] }, createToolContext('manim'))

    assert.equal(result.metadata?.status, 'found')
    assert.equal(result.metadata?.source, 'fake-catalog')
    assert.equal(result.metadata?.query, 'Axes')
    assert.deepEqual(result.metadata?.symbols, ['Axes'])
    assert.equal(result.metadata?.cached, true)
    assert.equal(result.metadata?.truncated, true)
    assert.equal(result.output.length, STUDIO_KNOWLEDGE_LIMITS.maxContentChars)
    assert.ok(result.output.length <= STUDIO_KNOWLEDGE_LIMITS.maxContentChars)

    const secondLookup = await lookupTool.execute({ query: 'Axes', symbols: [] }, createToolContext('manim'))
    assert.equal(secondLookup.metadata?.truncated, true)

    const defaultTool = createSharedStudioTools().find((tool) => tool.name === 'lookup-api')!
    const unavailable = await defaultTool.execute({ query: 'Axes' }, createToolContext('plot'))
    assert.equal(unavailable.metadata?.status, 'unavailable')
    assert.equal(unavailable.metadata?.truncated, false)
    assert.match(unavailable.output, /Status: UNAVAILABLE/)
  })

  await run('shared tool set registers lookup-api exactly once per Studio kind', async () => {
    const registry = new StudioToolRegistry()
    configureStudioToolRegistry({ registry, knowledgeProvider: createUnavailableStudioKnowledgeProvider() })

    assert.equal(registry.list().filter((tool) => tool.name === 'lookup-api').length, 1)
    assert.equal(registry.listForAgent('builder', 'manim').filter((tool) => tool.name === 'lookup-api').length, 1)
    assert.equal(registry.listForAgent('builder', 'plot').filter((tool) => tool.name === 'lookup-api').length, 1)
    assert.equal(createSharedStudioTools().filter((tool) => tool.name === 'lookup-api').length, 1)

    const sharedNames = createSharedStudioTools().map((tool) => tool.name)
    assert.deepEqual(sharedNames, [
      'read',
      'glob',
      'grep',
      'ls',
      'write',
      'edit',
      'apply_patch',
      'static-check',
      'lookup-api'
    ])
  })

  await run('system prompt has no pre-injected documentation block', async () => {
    const session = createStudioSession({
      ownerId: 'owner-knowledge',
      projectId: 'project-1',
      agentType: 'builder',
      title: 'Knowledge prompt session',
      directory: await createWorkspace(),
      studioKind: 'plot'
    })
    const prompt = buildStudioAgentSystemPrompt({ session })

    assert.doesNotMatch(prompt, /<studio_documentation>/)
    assert.match(prompt, /<studio_scene>/)
  })

  await run('runtime service composes a knowledge provider without eager lookup', async () => {
    let lookups = 0
    const knowledgeProvider: StudioKnowledgeProvider = {
      async lookup(request) {
        lookups += 1
        return {
          status: 'unavailable',
          source: 'counting',
          query: request.query,
          symbols: request.symbols,
          content: 'Status: UNAVAILABLE',
          cached: false,
          truncated: false
        }
      }
    }
    const service = createStudioRuntimeService({
      persistence: createInMemoryStudioPersistence(),
      workspaceProvider: createLocalStudioWorkspaceProvider(),
      knowledgeProvider
    })

    const session = await service.createSession({
      ownerId: 'owner-knowledge',
      projectId: 'project-1',
      directory: await createWorkspace(),
      useDedicatedWorkspace: false,
      studioKind: 'manim',
      agentType: 'builder'
    })

    assert.ok(session.id)
    assert.equal(lookups, 0, 'composition and session creation must not perform knowledge lookups')
  })
}

function createToolContext(studioKind: 'manim' | 'plot'): StudioRuntimeBackedToolContext {
  const session = createStudioSession({
    ownerId: 'owner-knowledge',
    projectId: 'project-1',
    studioKind,
    agentType: 'builder',
    title: `${studioKind} knowledge session`,
    directory: `/workspace/${studioKind}`
  })

  return {
    projectId: session.projectId,
    session,
    run: createStudioRun({
      ownerId: session.ownerId,
      sessionId: session.id,
      inputText: 'verify an api',
      activeAgent: 'builder'
    }),
    assistantMessage: createStudioAssistantMessage({
      sessionId: session.id,
      agent: 'builder'
    }),
    eventBus: new InMemoryStudioEventBus()
  }
}

function createFakeManimApiProvider(
  handler: (request: ManimApiRequest) => Promise<ManimApiResult>
): ManimApiProvider {
  return { lookup: handler }
}

function fakeProviderReturning(result: StudioKnowledgeResult): StudioKnowledgeProvider {
  return {
    async lookup() {
      return result
    }
  }
}
