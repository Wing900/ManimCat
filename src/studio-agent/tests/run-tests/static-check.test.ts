import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { mkdtemp, writeFile } from 'node:fs/promises'
import {
  createLegacyRunExecutionScope,
  createDefaultStudioStaticCheckPort,
  createStudioAssistantMessage,
  createStudioRun,
  createStudioSession,
  createStudioRenderTool,
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
import { runStaticChecks, parseImageCodeUnits } from '../../../services/static-guard/checker'
import type { StaticDiagnostic } from '../../../services/static-guard/types'
import { createSharedStudioTools } from '../../shared/register-shared-tools'
import { createPlotStudioRenderTool } from '../../plot/tools/plot-render-tool'
import { registerManimStudioTools } from '../../manim/register-manim-tools'
import { registerPlotStudioTools } from '../../plot/register-plot-tools'
import { run } from './factories'
import { isStudioRunCancelledError } from '../../runtime/execution/run-cancellation'

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

    // Two arguments only: Manim image-block policy (image mode, line offsets) stays in runStaticChecks.
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
    // No line offset: no image splitting, no Manim image policy. There is no ignore predicate left.
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

  await run('the render Tool checks before it reserves anything, and a blocked check renders nothing', async () => {
    const context = await createToolContext(await createWorkspaceWithSource(), 'manim')
    const tool = createStudioRenderTool(undefined, {
      async check() {
        return { kind: 'manim', outputMode: 'video', diagnostics: [diagnostic(4, 'boom', 2)] }
      }
    })

    const result = await tool.execute({ concept: 'scene', code: 'print(1)\n' }, context)

    assert.equal(result.title, 'Static check: scene')
    assert.equal(result.output, 'py_compile:4:2 boom')
    assert.equal(result.metadata?.phase, 'static-check')
    assert.equal(result.metadata?.kind, 'manim')
    assert.equal(result.metadata?.outputMode, 'video')
    assert.equal(result.metadata?.diagnosticCount, 1)
    assert.deepEqual(result.metadata?.diagnostics, [diagnostic(4, 'boom', 2)])
    // Nothing was reserved: no render record exists for a source that never passed the check.
    assert.ok(context.renderStore)
    assert.deepEqual(await context.renderStore.listBySessionId(context.session.ownerId, context.session.id), [])
  })

  for (const kind of ['manim', 'plot'] as const) {
    for (const stage of ['before-check', 'during-check', 'during-blocked-check', 'during-persistence'] as const) {
      await run(`${kind} cancellation ${stage} never starts rendering`, async () => {
        const context = await createToolContext(await createWorkspaceWithSource(), kind)
        const controller = new AbortController()
        context.abortSignal = controller.signal
        let checks = 0
        let renders = 0
        const port: StudioStaticCheckPort = {
          async check(request) {
            checks += 1
            if (stage === 'during-check' || stage === 'during-blocked-check') {
              controller.abort('stopped during check')
            }
            return {
              kind: request.kind,
              outputMode: request.outputMode ?? 'video',
              diagnostics: stage === 'during-blocked-check' ? [diagnostic(1, 'broken source')] : []
            }
          }
        }
        assert.ok(context.renderStore)
        if (stage === 'before-check') {
          controller.abort('stopped before check')
        }
        if (stage === 'during-persistence') {
          const create = context.renderStore.create.bind(context.renderStore)
          context.renderStore.create = async (render) => {
            const result = await create(render)
            controller.abort('stopped during persistence')
            return result
          }
        }
        const tool = kind === 'manim'
          ? createStudioRenderTool({
              async submit(input) {
                renders += 1
                return { jobId: input.jobId }
              }
            }, port)
          : createPlotStudioRenderTool({
              async execute() {
                renders += 1
                throw new Error('cancelled render must never execute')
              }
            }, port)

        await assert.rejects(
          () => tool.execute({ concept: 'cancelled scene', code: 'print(1)\n' }, context),
          isStudioRunCancelledError
        )
        assert.equal(checks, stage === 'before-check' ? 0 : 1)
        assert.equal(renders, 0)
        const records = await context.renderStore.listBySessionId(context.session.ownerId, context.session.id)
        if (stage === 'during-persistence') {
          assert.equal(records.length, 1)
          assert.equal(records[0].status, 'cancelled')
        } else {
          assert.deepEqual(records, [])
        }
      })
    }
  }

  await run('the check request carries the session kind, never a caller-supplied one', async () => {
    const workspace = await createWorkspaceWithSource()
    const seen: StudioStaticCheckRequest[] = []
    const failing: StudioStaticCheckPort = {
      async check(request) {
        seen.push(request)
        return { kind: request.kind, outputMode: 'image', diagnostics: [diagnostic(1, 'boom')] }
      }
    }

    await createPlotStudioRenderTool(undefined, failing).execute(
      { concept: 'plot', code: 'print(1)\n' },
      await createToolContext(workspace, 'plot')
    )
    await createStudioRenderTool(undefined, failing).execute(
      { concept: 'scene', code: 'print(1)\n' },
      await createToolContext(workspace, 'manim')
    )

    assert.deepEqual(seen.map((request) => request.kind), ['plot', 'manim'])
    assert.equal(seen[0].code, 'print(1)\n')
  })

  await run('the check defaults a session without a Studio kind to Manim', async () => {
    const seen: StudioStaticCheckRequest[] = []
    await createStudioRenderTool(undefined, {
      async check(request) {
        seen.push(request)
        return { kind: request.kind, outputMode: 'video', diagnostics: [diagnostic(1, 'boom')] }
      }
    }).execute({ concept: 'scene', code: 'print(1)\n' }, await createToolContext(await createWorkspaceWithSource(), undefined))

    assert.deepEqual(seen.map((request) => request.kind), ['manim'])
  })

  await run('an unconfigured check Port fails loudly instead of rendering', async () => {
    assert.ok(createUnconfiguredStudioStaticCheckPort())
    await assert.rejects(
      async () => {
        const context = await createToolContext(await createWorkspaceWithSource(), 'manim')
        return createStudioRenderTool().execute({ concept: 'scene', code: 'print(1)\n' }, context)
      },
      /No Studio static check adapter is configured for kind: manim/
    )
  })

  await run('no standalone check Tool is registered, and each render Tool owns its own check', async () => {
    assert.equal(createSharedStudioTools().some((tool) => tool.name === 'static-check'), false)

    const seen: StudioStaticCheckRequest[] = []
    const port: StudioStaticCheckPort = {
      async check(request) {
        seen.push(request)
        return { kind: request.kind, outputMode: 'video', diagnostics: [diagnostic(1, 'boom')] }
      }
    }
    const registry = new StudioToolRegistry()
    registerManimStudioTools(registry, undefined, port)
    registerPlotStudioTools(registry, undefined, port)

    assert.equal(registry.list().filter((tool) => tool.name === 'render').length, 2)
    const manimTool = registry.get('render', 'manim')
    const plotTool = registry.get('render', 'plot')
    assert.ok(manimTool)
    assert.ok(plotTool)
    assert.notEqual(manimTool, plotTool)

    await manimTool.execute(
      { concept: 'scene', code: 'print(1)\n' },
      await createToolContext(await createWorkspaceWithSource(), 'manim')
    )
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

  await run('an inline image marker maps its code to the same document line', async () => {
    const source = '#!/usr/bin/env python\n### YON_IMAGE_1_START ###x = 1\n### YON_IMAGE_1_END ###'
    const units = parseImageCodeUnits(source)

    assert.equal(units.length, 1)
    assert.equal(units[0].code, 'x = 1')
    assert.equal(units[0].lineOffset, 1)
    assert.equal(1 + units[0].lineOffset, 2)
  })

  await run('blank lines between the marker and the code count in the offset', async () => {
    const source = ['header', '### YON_IMAGE_1_START ###', '', '', 'x = 1', '### YON_IMAGE_1_END ###'].join('\n')
    const units = parseImageCodeUnits(source)

    assert.equal(units.length, 1)
    assert.equal(units[0].code, 'x = 1')
    assert.equal(units[0].lineOffset, 4)
    assert.equal(1 + units[0].lineOffset, 5)
  })

  await run('CRLF sources keep their document line mapping', async () => {
    const source = ['header', '### YON_IMAGE_1_START ###', 'x = 1', 'y = 2', '### YON_IMAGE_1_END ###'].join('\r\n')
    const units = parseImageCodeUnits(source)

    assert.equal(units.length, 1)
    assert.equal(units[0].code, 'x = 1\r\ny = 2')
    assert.equal(units[0].lineOffset, 2)
    assert.equal(2 + units[0].lineOffset, 4)
  })

  await run('indented code keeps trimming compatibility and the line mapping', async () => {
    const source = ['### YON_IMAGE_1_START ###', '    x = 1', '    y = 2', '### YON_IMAGE_1_END ###'].join('\n')
    const units = parseImageCodeUnits(source)

    assert.equal(units.length, 1)
    assert.equal(units[0].code, 'x = 1\n    y = 2')
    assert.equal(units[0].lineOffset, 1)
    assert.equal(1 + units[0].lineOffset, 2)
  })

  await run('multiple image blocks keep independent absolute offsets', async () => {
    const source = [
      'header',
      '### YON_IMAGE_1_START ###',
      'first',
      '### YON_IMAGE_1_END ###',
      '',
      '### YON_IMAGE_2_START ###',
      '',
      'second',
      '### YON_IMAGE_2_END ###'
    ].join('\n')
    const units = parseImageCodeUnits(source)

    assert.equal(units.length, 2)
    assert.equal(units[0].code, 'first')
    assert.equal(units[0].lineOffset, 2)
    assert.equal(units[1].code, 'second')
    assert.equal(units[1].lineOffset, 7)
  })

  await run('unit-relative diagnostic lines map onto document lines', async () => {
    const units = parseImageCodeUnits(IMAGE_SOURCE)

    assert.equal(1 + units[0].lineOffset, 3)
    assert.equal(2 + units[0].lineOffset, 4)
    assert.equal(1 + units[1].lineOffset, 8)
  })

  await run('a source without image markers stays one unit at offset zero', async () => {
    const units = parseImageCodeUnits('print(1)\nprint(2)')

    assert.equal(units.length, 1)
    assert.equal(units[0].code, 'print(1)\nprint(2)')
    assert.equal(units[0].lineOffset, 0)
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
  return { tool: 'py_compile', line, column, message }
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
    renderStore: new InMemoryStudioRenderStore(),
    executionScope: createLegacyRunExecutionScope({ rootDirectory: session.directory })
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
