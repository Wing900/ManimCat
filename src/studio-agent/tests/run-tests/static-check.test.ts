import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { mkdtemp, writeFile } from 'node:fs/promises'
import {
  createDefaultStudioStaticCheckPort,
  createStudioAssistantMessage,
  createStudioRun,
  createStudioSession,
  createStudioStaticCheckTool,
  createUnconfiguredStudioStaticCheckPort,
  InMemoryStudioEventBus,
  InMemoryStudioRenderStore,
  ManimStaticCheckAdapter,
  MatplotlibStaticCheckAdapter,
  StudioStaticCheckRouter,
  StudioToolRegistry,
  type StudioKind,
  type StudioRuntimeBackedToolContext,
  type StudioStaticCheckAdapter,
  type StudioStaticCheckPort,
  type StudioStaticCheckRequest,
  type StudioStaticCheckResult
} from '../../index'
import {
  runStaticChecks,
  shouldIgnoreManimCameraDiagnostic,
  parseImageCodeUnits
} from '../../../services/static-guard/checker'
import type { StaticDiagnostic } from '../../../services/static-guard/types'
import { createSharedStudioTools } from '../../shared/register-shared-tools'
import { run } from './factories'

const IMAGE_SOURCE = [
  'header',
  '### YON_IMAGE_1_START ###',
  'line a',
  'line b',
  '### YON_IMAGE_1_END ###',
  'footer',
  '### YON_IMAGE_2_START ###',
  'second',
  '### YON_IMAGE_2_END ###',
  ''
].join('\n')

export async function runStaticCheckTests(): Promise<void> {
  await run('router sends Manim requests to the Manim adapter only', async () => {
    const calls: string[] = []
    const router = createRouter({
      manim: async (request) => {
        calls.push(`manim:${request.code}`)
        return { kind: 'manim', outputMode: 'video', diagnostics: [] }
      },
      plot: async () => {
        calls.push('plot')
        return { kind: 'plot', outputMode: 'image', diagnostics: [] }
      }
    })

    const result = await router.check({ kind: 'manim', code: 'scene' })

    assert.deepEqual(calls, ['manim:scene'])
    assert.equal(result.kind, 'manim')
  })

  await run('router sends Plot requests to the Matplotlib adapter only', async () => {
    const calls: string[] = []
    const router = createRouter({
      manim: async () => {
        calls.push('manim')
        return { kind: 'manim', outputMode: 'video', diagnostics: [] }
      },
      plot: async (request) => {
        calls.push(`plot:${request.code}`)
        return { kind: 'plot', outputMode: 'image', diagnostics: [] }
      }
    })

    const result = await router.check({ kind: 'plot', code: 'figure' })

    assert.deepEqual(calls, ['plot:figure'])
    assert.equal(result.kind, 'plot')
  })

  await run('router fails explicitly instead of falling back across domains', async () => {
    const manimOnly = new StudioStaticCheckRouter({
      adapters: {
        manim: {
          async check(): Promise<never> {
            throw new Error('the Manim adapter must not serve a Plot request')
          }
        }
      }
    })
    const plotOnly = new StudioStaticCheckRouter({
      adapters: {
        plot: {
          async check(): Promise<never> {
            throw new Error('the Matplotlib adapter must not serve a Manim request')
          }
        }
      }
    })

    await assert.rejects(
      () => manimOnly.check({ kind: 'plot', code: 'figure' }),
      /No Studio static check adapter is configured for kind: plot/
    )
    await assert.rejects(
      () => plotOnly.check({ kind: 'manim', code: 'scene' }),
      /No Studio static check adapter is configured for kind: manim/
    )
  })

  await run('Manim adapter defaults to video and forwards the image mode', async () => {
    const calls: Array<[string, string]> = []
    const adapter = new ManimStaticCheckAdapter(async (code, outputMode) => {
      calls.push([code, outputMode])
      return { diagnostics: [diagnostic(7, 'from the engine')] }
    })

    const defaulted = await adapter.check({ kind: 'manim', code: 'scene' })
    const forwarded = await adapter.check({ kind: 'manim', code: 'image scene', outputMode: 'image' })

    // Two arguments only: Manim policy (image blocks, camera frames) stays in runStaticChecks.
    assert.deepEqual(calls, [['scene', 'video'], ['image scene', 'image']])
    assert.equal(defaulted.kind, 'manim')
    assert.equal(defaulted.outputMode, 'video')
    assert.deepEqual(defaulted.diagnostics, [diagnostic(7, 'from the engine')])
    assert.equal(forwarded.outputMode, 'image')
  })

  await run('Matplotlib adapter checks one whole file without Manim policy', async () => {
    const calls: Array<{ code: string; options: unknown }> = []
    const adapter = new MatplotlibStaticCheckAdapter(async (code, options) => {
      calls.push({ code, options })
      return { diagnostics: [diagnostic(3, 'plot diagnostic')] }
    })

    const result = await adapter.check({ kind: 'plot', code: IMAGE_SOURCE })

    assert.equal(calls.length, 1)
    assert.equal(calls[0].code, IMAGE_SOURCE)
    // No line offset and no ignore predicate: no image splitting, no camera suppression.
    assert.equal(calls[0].options, undefined)
    assert.equal(result.kind, 'plot')
    assert.equal(result.outputMode, 'image')
    assert.deepEqual(result.diagnostics, [diagnostic(3, 'plot diagnostic')])
  })

  await run('Plot requests keep the effective image mode when video is requested', async () => {
    const adapter = new MatplotlibStaticCheckAdapter(async () => ({ diagnostics: [] }))

    const result = await adapter.check({ kind: 'plot', code: 'figure', outputMode: 'video' })

    assert.equal(result.outputMode, 'image')
    assert.equal(result.kind, 'plot')
  })

  await run('Tool derives the Studio kind from the session context', async () => {
    const workspace = await createWorkspaceWithSource()
    const seen: StudioStaticCheckRequest[] = []
    const tool = createStudioStaticCheckTool({
      async check(request) {
        seen.push(request)
        return { kind: request.kind, outputMode: 'image', diagnostics: [] }
      }
    })

    await tool.execute({ path: 'scene.py' }, createToolContext(workspace, 'plot'))
    await tool.execute({ path: 'scene.py' }, createToolContext(workspace, 'manim'))

    assert.deepEqual(seen.map((request) => request.kind), ['plot', 'manim'])
    assert.equal(seen[0].code, 'print(1)\n')
    assert.equal(seen[0].outputMode, undefined)
  })

  await run('Tool defaults a session without a Studio kind to Manim', async () => {
    const workspace = await createWorkspaceWithSource()
    const seen: StudioStaticCheckRequest[] = []
    const tool = createStudioStaticCheckTool({
      async check(request) {
        seen.push(request)
        return { kind: request.kind, outputMode: 'video', diagnostics: [] }
      }
    })

    await tool.execute({ path: 'scene.py' }, createToolContext(workspace, undefined))

    assert.deepEqual(seen.map((request) => request.kind), ['manim'])
  })

  await run('Tool metadata reports the effective kind, mode and diagnostics', async () => {
    const workspace = await createWorkspaceWithSource()
    const tool = createStudioStaticCheckTool({
      async check() {
        return { kind: 'plot', outputMode: 'image', diagnostics: [diagnostic(4, 'boom', 2)] }
      }
    })

    const result = await tool.execute({ path: 'scene.py', outputMode: 'video' }, createToolContext(workspace, 'plot'))

    assert.equal(result.title, 'Static check scene.py')
    assert.equal(result.output, 'mypy:4:2 boom')
    assert.equal(result.metadata?.path, 'scene.py')
    assert.equal(result.metadata?.kind, 'plot')
    assert.equal(result.metadata?.outputMode, 'image')
    assert.equal(result.metadata?.diagnosticCount, 1)
    assert.deepEqual(result.metadata?.diagnostics, [diagnostic(4, 'boom', 2)])
    assert.equal(result.metadata?.truncated, false)
  })

  await run('Tool without a configured Port fails loudly', async () => {
    const workspace = await createWorkspaceWithSource()
    const tool = createStudioStaticCheckTool()

    assert.ok(createUnconfiguredStudioStaticCheckPort())
    await assert.rejects(
      () => tool.execute({ path: 'scene.py' }, createToolContext(workspace, 'plot')),
      /No Studio static check adapter is configured for kind: plot/
    )
  })

  await run('shared registry resolves exactly one static-check Tool per Studio kind', async () => {
    const seen: StudioStaticCheckRequest[] = []
    const staticCheckPort: StudioStaticCheckPort = {
      async check(request) {
        seen.push(request)
        return { kind: request.kind, outputMode: 'video', diagnostics: [] }
      }
    }
    const registry = new StudioToolRegistry()
    for (const tool of createSharedStudioTools({ staticCheckPort })) {
      registry.register(tool)
    }

    assert.equal(registry.list().filter((tool) => tool.name === 'static-check').length, 1)
    const manimTool = registry.get('static-check', 'manim')
    const plotTool = registry.get('static-check', 'plot')
    assert.ok(manimTool)
    assert.ok(plotTool)
    assert.equal(manimTool, plotTool)

    // The dependency bag must carry the injected Port into the shared Tool.
    await manimTool.execute({ path: 'scene.py' }, createToolContext(await createWorkspaceWithSource(), 'manim'))
    assert.deepEqual(seen.map((request) => request.kind), ['manim'])
  })

  await run('default Port composition carries both Adapters over the shared engine', async () => {
    const manimCalls: string[] = []
    const plotCalls: string[] = []
    const port = createDefaultStudioStaticCheckPort({
      manimRunner: async (code, outputMode) => {
        manimCalls.push(`${code}:${outputMode}`)
        return { diagnostics: [] }
      },
      plotRunner: async (code) => {
        plotCalls.push(code)
        return { diagnostics: [] }
      }
    })

    const manim = await port.check({ kind: 'manim', code: 'a' })
    const plot = await port.check({ kind: 'plot', code: 'b' })

    assert.deepEqual(manimCalls, ['a:video'])
    assert.deepEqual(plotCalls, ['b'])
    assert.equal(manim.kind, 'manim')
    assert.equal(manim.outputMode, 'video')
    assert.equal(plot.kind, 'plot')
    assert.equal(plot.outputMode, 'image')
  })

  await run('classic runStaticChecks stays the static-guard manager entry', async () => {
    assert.equal(typeof runStaticChecks, 'function')
    assert.equal(runStaticChecks.length, 2)

    const managerSource = fs.readFileSync(staticGuardFile('manager.ts'), 'utf8')
    assert.match(managerSource, /import \{ runStaticChecks \} from '\.\/checker'/)
    assert.match(managerSource, /await runStaticChecks\(/)
  })

  await run('image code units keep their document line offsets', async () => {
    const units = parseImageCodeUnits(IMAGE_SOURCE)

    assert.equal(units.length, 2)
    assert.equal(units[0].code, 'line a\nline b')
    assert.equal(units[0].lineOffset, 2)
    assert.equal(units[1].code, 'second')
    assert.equal(units[1].lineOffset, 7)
  })

  await run('a source without image markers stays one unit at offset zero', async () => {
    const units = parseImageCodeUnits('print(1)\nprint(2)')

    assert.equal(units.length, 1)
    assert.equal(units[0].code, 'print(1)\nprint(2)')
    assert.equal(units[0].lineOffset, 0)
  })

  await run('Manim camera.frame mypy diagnostics are ignored by policy', async () => {
    const code = 'self.camera.frame.animate.set(width=10)'
    const cameraDiagnostic: StaticDiagnostic = {
      tool: 'mypy',
      line: 1,
      column: 1,
      code: 'attr-defined',
      message: 'Camera has no attribute "frame"'
    }

    assert.equal(shouldIgnoreManimCameraDiagnostic(cameraDiagnostic, code, 0), true)
    assert.equal(shouldIgnoreManimCameraDiagnostic({ ...cameraDiagnostic, line: 2 }, code, 1), true)
    assert.equal(shouldIgnoreManimCameraDiagnostic(cameraDiagnostic, 'other = 1', 0), false)
    assert.equal(shouldIgnoreManimCameraDiagnostic({ ...cameraDiagnostic, code: 'assignment' }, code, 0), false)
    assert.equal(
      shouldIgnoreManimCameraDiagnostic({ ...cameraDiagnostic, message: 'Camera has no attribute "zoom"' }, code, 0),
      false
    )
    assert.equal(
      shouldIgnoreManimCameraDiagnostic({ tool: 'py_compile', line: 1, message: 'SyntaxError' }, code, 0),
      false
    )
  })
}

function createRouter(
  handlers: Partial<Record<StudioKind, (request: StudioStaticCheckRequest) => Promise<StudioStaticCheckResult>>>
): StudioStaticCheckPort {
  const adapters: Partial<Record<StudioKind, StudioStaticCheckAdapter>> = {}
  for (const kind of ['manim', 'plot'] as StudioKind[]) {
    const handler = handlers[kind]
    if (handler) {
      adapters[kind] = { check: handler }
    }
  }
  return new StudioStaticCheckRouter({ adapters })
}

function diagnostic(line: number, message: string, column?: number): StaticDiagnostic {
  return { tool: 'mypy', line, column, message }
}

function createToolContext(directory: string, studioKind?: StudioKind): StudioRuntimeBackedToolContext {
  const session = createStudioSession({
    ownerId: 'owner-test',
    projectId: 'project-1',
    studioKind,
    agentType: 'builder',
    title: 'static check test session',
    directory
  })
  const runRecord = createStudioRun({
    ownerId: session.ownerId,
    sessionId: session.id,
    inputText: 'check the scene',
    activeAgent: 'builder'
  })

  return {
    projectId: session.projectId,
    session,
    run: runRecord,
    assistantMessage: createStudioAssistantMessage({ sessionId: session.id, agent: 'builder' }),
    eventBus: new InMemoryStudioEventBus(),
    renderStore: new InMemoryStudioRenderStore()
  }
}

async function createWorkspaceWithSource(): Promise<string> {
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'manimcat-static-check-'))
  await writeFile(path.join(workspace, 'scene.py'), 'print(1)\n', 'utf8')
  return workspace
}

function staticGuardFile(fileName: string): string {
  const fromCwd = path.join(process.cwd(), 'src', 'services', 'static-guard', fileName)
  if (fs.existsSync(fromCwd)) {
    return fromCwd
  }
  return path.resolve(__dirname, '..', '..', '..', '..', '..', 'src', 'services', 'static-guard', fileName)
}
