import assert from 'node:assert/strict'
import {
  createDefaultStudioKnowledgeProvider,
  lookupStudioKnowledge,
  MatplotlibKnowledgeAdapter,
  MATPLOTLIB_KNOWLEDGE_SOURCE,
  resolveMatplotlibCatalogPython,
  validateRuntimeMatplotlibCatalog,
  type MatplotlibCatalogLoader,
  type PythonRuntimeCatalog,
  type PythonRuntimeSymbolRecord,
} from '../../index'
import { run } from './factories'

export async function runMatplotlibKnowledgeTests(): Promise<void> {
  await run('exact canonical symbol lookup resolves matplotlib.axes.Axes', async () => {
    const adapter = createAdapter()
    const result = await lookup(adapter, { query: 'main Axes class', symbols: ['matplotlib.axes.Axes'] })

    assert.equal(result.status, 'found')
    assert.equal(result.source, MATPLOTLIB_KNOWLEDGE_SOURCE)
    assert.match(result.content, /\[exact\] class matplotlib\.axes\.Axes/)
    assert.match(result.content, /Aliases: matplotlib\.pyplot\.Axes/)
  })

  await run('short name and plt. alias lookup resolve the same function', async () => {
    const adapter = createAdapter()

    const shortName = await lookup(adapter, { query: 'draw lines', symbols: ['plot'] })
    assert.equal(shortName.status, 'found')
    assert.match(shortName.content, /matplotlib\.pyplot\.plot/)

    const pltAlias = await lookup(adapter, { query: 'draw lines', symbols: ['plt.plot'] })
    assert.equal(pltAlias.status, 'found')
    assert.match(pltAlias.content, /\[exact\] function matplotlib\.pyplot\.plot/)

    const canonical = await lookup(adapter, { query: 'draw lines', symbols: ['matplotlib.pyplot.plot'] })
    assert.match(canonical.content, /\[exact\] function matplotlib\.pyplot\.plot/)
  })

  await run('exact class member lookup resolves Axes.plot with its signature', async () => {
    const adapter = createAdapter()
    const result = await lookup(adapter, { query: 'line plot member', symbols: ['Axes.plot'] })

    assert.equal(result.status, 'found')
    assert.match(result.content, /\[exact\] method matplotlib\.axes\.Axes\.plot\(self, \*args, scalex=True/)
    assert.match(result.content, /Owner: matplotlib\.axes\.Axes/)
  })

  await run('inherited member lookup walks the catalog MRO', async () => {
    const adapter = createAdapter()
    const result = await lookup(adapter, { query: 'artist label member', symbols: ['Axes.set_label'] })

    assert.equal(result.status, 'found')
    assert.match(result.content, /\[inherited\] method matplotlib\.axes\.Axes\.set_label\(self, s\)/)
    assert.match(result.content, /Owner: matplotlib\.artist\.Artist/)
  })

  await run('keyword search matches symbol and member documentation', async () => {
    const adapter = createAdapter()
    const result = await lookup(adapter, { query: 'scatter marker color', symbols: [] })

    assert.equal(result.status, 'found')
    assert.match(result.content, /\[search\] method matplotlib\.axes\.Axes\.scatter/)
    assert.ok(matchCount(result.content) >= 2)
  })

  await run('fuzzy symbol lookup recovers a misspelled short name', async () => {
    const adapter = createAdapter()
    const result = await lookup(adapter, { query: 'misspelled symbol', symbols: ['Axess'] })

    assert.equal(result.status, 'found')
    assert.match(result.content, /\[fuzzy\] class matplotlib\.axes\.Axes/)
  })

  await run('fuzzy member lookup recovers Axes.scatr', async () => {
    const adapter = createAdapter()
    const result = await lookup(adapter, { query: 'misspelled member', symbols: ['Axes.scatr'] })

    assert.equal(result.status, 'found')
    assert.match(result.content, /\[fuzzy\] method matplotlib\.axes\.Axes\.scatter/)
  })

  await run('matches are deduplicated, deterministic, and capped at 12', async () => {
    const adapter = createAdapter()

    const duplicated = await lookup(adapter, {
      query: 'duplicates',
      symbols: ['Axes', 'Axes', 'matplotlib.axes.Axes', 'plt.plot', 'matplotlib.pyplot.plot']
    })
    assert.equal(matchCount(duplicated.content), 2)

    const wide = await lookup(adapter, { query: 'capability helper', symbols: [] })
    assert.equal(matchCount(wide.content), 12)

    const repeated = await lookup(adapter, { query: 'capability helper', symbols: [] })
    assert.equal(repeated.content, wide.content)
  })

  await run('found formatting reports runtime versions and signatures', async () => {
    const adapter = createAdapter()
    const result = await lookup(adapter, { query: 'scatter member', symbols: ['Axes.scatter'] })

    assert.match(result.content, /Status: FOUND/)
    assert.match(result.content, /Runtime: matplotlib 3\.9\.2 \/ Python 3\.12\.1/)
    assert.match(result.content, /\(self, x, y, s=None, c=None, marker=None/)
    assert.match(result.content, /Query: scatter member/)
    assert.match(result.content, /Symbols: Axes\.scatter/)
  })

  await run('missing lookup returns not_found without inventing an API', async () => {
    const adapter = createAdapter()

    const noSymbols = await lookup(adapter, { query: 'xyzzy frobnicate', symbols: [] })
    assert.equal(noSymbols.status, 'not_found')
    assert.match(noSymbols.content, /Status: NOT_FOUND/)
    assert.match(noSymbols.content, /Do not invent an API/)
    assert.doesNotMatch(noSymbols.content, /Status: FOUND/)

    const distantSymbol = await lookup(adapter, { query: 'nonsense', symbols: ['zzqqxxww'] })
    assert.equal(distantSymbol.status, 'not_found')
    assert.doesNotMatch(distantSymbol.content, /\[fuzzy\]/)
  })

  await run('catalog loader failure returns sanitized unavailable content', async () => {
    const adapter = new MatplotlibKnowledgeAdapter(async () => {
      throw new Error('catalog exploded at /opt/matplotlib/secret token=abc123')
    })

    const result = await lookup(adapter, { query: 'Axes', symbols: ['Axes'] })

    assert.equal(result.status, 'unavailable')
    assert.equal(result.source, MATPLOTLIB_KNOWLEDGE_SOURCE)
    assert.match(result.content, /Status: UNAVAILABLE/)
    assert.match(result.content, /Do not invent an API/)
    assert.ok(!result.content.includes('exploded'), 'raw error text must not leak')
    assert.ok(!result.content.includes('/opt/matplotlib'), 'host paths must not leak')
    assert.ok(!result.content.includes('token=abc123'), 'credentials must not leak')
  })

  await run('repeated identical lookup is cached and loads the catalog once', async () => {
    const loader = createCountingLoader()
    const adapter = new MatplotlibKnowledgeAdapter(loader)

    const first = await lookup(adapter, { query: 'Axes class', symbols: ['Axes'] })
    const second = await lookup(adapter, { query: 'Axes class', symbols: ['Axes'] })

    assert.equal(loader.calls, 1)
    assert.equal(first.cached, false)
    assert.equal(second.cached, true)
    assert.equal(second.content, first.content)
  })

  await run('different request keys reuse the loaded catalog', async () => {
    const loader = createCountingLoader()
    const adapter = new MatplotlibKnowledgeAdapter(loader)

    const axes = await lookup(adapter, { query: 'Axes class', symbols: ['Axes'] })
    const figure = await lookup(adapter, { query: 'Figure class', symbols: ['Figure'] })

    assert.equal(loader.calls, 1)
    assert.equal(axes.status, 'found')
    assert.equal(figure.status, 'found')
    assert.equal(figure.cached, false)
  })

  await run('default provider routes Plot requests to the Matplotlib adapter', async () => {
    const loader = createCountingLoader()
    const provider = createDefaultStudioKnowledgeProvider({ plotCatalogLoader: loader })

    const result = await lookup(provider, { query: 'Axes class', symbols: ['Axes'] }, 'plot')

    assert.equal(result.status, 'found')
    assert.equal(result.source, MATPLOTLIB_KNOWLEDGE_SOURCE)
    assert.equal(loader.calls, 1)
  })

  await run('production provider construction stays lazy', async () => {
    const loader = createCountingLoader()
    const provider = createDefaultStudioKnowledgeProvider({ plotCatalogLoader: loader })

    assert.equal(loader.calls, 0, 'constructing the provider must not start Python')

    await lookup(provider, { query: 'Figure class', symbols: ['Figure'] }, 'plot')
    assert.equal(loader.calls, 1)
  })

  await run('python selection prefers trusted environment configuration', async () => {
    assert.equal(resolveMatplotlibCatalogPython({ PLOT_PYTHON_BIN: '/usr/bin/python3' }), '/usr/bin/python3')
    assert.equal(
      resolveMatplotlibCatalogPython({ PYTHON_EXECUTABLE: '/usr/bin/python3.12', PYTHON_BIN: 'python3' }),
      '/usr/bin/python3.12'
    )
    assert.equal(resolveMatplotlibCatalogPython({ PYTHON_BIN: 'python3' }), 'python3')
    assert.equal(resolveMatplotlibCatalogPython({}), 'python')
  })

  await run('catalog validation accepts a structurally complete catalog', async () => {
    const catalog = validateRuntimeMatplotlibCatalog(createFakeCatalog())

    assert.equal(catalog.packageName, 'matplotlib')
    assert.ok(Object.keys(catalog.symbols).length >= 20)
  })

  await run('catalog validation rejects an array where a record is required', async () => {
    expectSchemaError({ ...createFakeCatalog(), symbols: [] })
  })

  await run('catalog validation rejects a malformed member kind', async () => {
    const catalog = createFakeCatalog()
    const axes = catalog.symbols['matplotlib.axes.Axes']
    const plot = (axes.members ?? {}).plot ?? {}

    expectSchemaError({
      ...catalog,
      symbols: {
        ...catalog.symbols,
        'matplotlib.axes.Axes': { ...axes, members: { plot: { ...plot, kind: 'not-a-kind' } } }
      }
    })
  })

  await run('catalog validation rejects a symbol key and path mismatch', async () => {
    const catalog = createFakeCatalog()

    expectSchemaError({
      ...catalog,
      symbols: { ...catalog.symbols, 'matplotlib.axes.NotAxes': catalog.symbols['matplotlib.axes.Axes'] }
    })
  })

  await run('catalog validation rejects a malformed MRO list', async () => {
    const catalog = createFakeCatalog()
    const axes = catalog.symbols['matplotlib.axes.Axes']

    expectSchemaError({
      ...catalog,
      symbols: { ...catalog.symbols, 'matplotlib.axes.Axes': { ...axes, mro: 'matplotlib.axes.Axes' } }
    })
  })

  await run('catalog validation rejects a dangling alias target', async () => {
    const catalog = createFakeCatalog()

    expectSchemaError({
      ...catalog,
      aliasIndex: { ...catalog.aliasIndex, 'matplotlib.pyplot.Ghost': 'matplotlib.ghost.Ghost' }
    })
  })

  await run('catalog validation rejects a missing canonical self-alias', async () => {
    const catalog = createFakeCatalog()
    const aliasIndex = { ...catalog.aliasIndex }
    delete aliasIndex['matplotlib.axes.Axes']

    expectSchemaError({ ...catalog, aliasIndex })
  })

  await run('catalog validation rejects a redeclared alias target', async () => {
    const catalog = createFakeCatalog()

    expectSchemaError({
      ...catalog,
      aliasIndex: { ...catalog.aliasIndex, 'matplotlib.pyplot.Axes': 'matplotlib.figure.Figure' }
    })
  })

  await run('catalog validation rejects a non-object module error map', async () => {
    expectSchemaError({ ...createFakeCatalog(), moduleErrors: [] })
  })

  await run('catalog validation rejects a wrong package name', async () => {
    expectSchemaError({ ...createFakeCatalog(), packageName: 'numpy' })
  })

  await run('inherited lookup still resolves through a private MRO base', async () => {
    const adapter = createAdapter()
    const result = await lookup(adapter, { query: 'grid member', symbols: ['Axes.grid'] })

    assert.equal(result.status, 'found')
    assert.match(result.content, /\[inherited\] method matplotlib\.axes\.Axes\.grid\(self, visible=None/)
    // The Owner line stays factual: the member really is defined on that base.
    assert.match(result.content, /Owner: matplotlib\.axes\._AxesBase/)
  })

  await run('keyword search never suggests a private MRO base', async () => {
    const adapter = createAdapter()
    const result = await lookup(adapter, { query: 'grid lines', symbols: [] })

    // The private symbol and its member outrank every public match in this query, so an
    // empty match section would also be a pass; the point is that neither leaks.
    assert.equal(result.status, 'found')
    assert.doesNotMatch(matchSection(result.content), /_AxesBase/)
  })

  await run('fuzzy symbol search never suggests a private MRO base', async () => {
    const adapter = createAdapter()
    const result = await lookup(adapter, { query: 'misspelled private base', symbols: ['AxesBase'] })

    assert.match(result.content, /\[fuzzy\] class matplotlib\.axes\.Axes/)
    assert.doesNotMatch(matchSection(result.content), /_AxesBase/)
  })

  await run('short-name and canonical lookup of a private symbol stay hidden', async () => {
    const adapter = createAdapter()

    const shortName = await lookup(adapter, { query: 'private base', symbols: ['_AxesBase'] })
    assert.equal(shortName.status, 'found')
    assert.doesNotMatch(matchSection(shortName.content), /_AxesBase/)

    const canonical = await lookup(adapter, { query: 'private base', symbols: ['matplotlib.axes._AxesBase'] })
    assert.equal(canonical.status, 'found')
    assert.doesNotMatch(matchSection(canonical.content), /matplotlib\.axes\._AxesBase/)
  })
}

function matchSection(content: string): string {
  // Request echo (query/symbols) is not a suggestion: only inspect the match section.
  return content.split('Matches:')[1] ?? ''
}

function expectSchemaError(candidate: unknown): void {
  assert.throws(
    () => validateRuntimeMatplotlibCatalog(candidate),
    (error: unknown) => {
      assert.ok(error instanceof Error)
      assert.equal(error.message, 'Runtime matplotlib catalog has an invalid schema')
      return true
    }
  )
}

function createAdapter(): MatplotlibKnowledgeAdapter {
  return new MatplotlibKnowledgeAdapter(createFakeCatalogLoader())
}

async function lookup(
  provider: Parameters<typeof lookupStudioKnowledge>[0],
  input: { query: string; symbols: string[] },
  kind: 'manim' | 'plot' = 'plot'
) {
  return lookupStudioKnowledge(provider, {
    kind,
    query: input.query,
    symbols: input.symbols,
    maxChars: 6000
  })
}

function createFakeCatalogLoader(): MatplotlibCatalogLoader {
  return async () => createFakeCatalog()
}

function createCountingLoader(): MatplotlibCatalogLoader & { readonly calls: number } {
  let calls = 0
  const loader: MatplotlibCatalogLoader = async () => {
    calls += 1
    return createFakeCatalog()
  }
  return Object.assign(loader, { get calls() { return calls } })
}

function matchCount(content: string): number {
  return (content.match(/^\[(exact|inherited|search|fuzzy)\]/gm) ?? []).length
}

function createFakeCatalog(): PythonRuntimeCatalog {
  const symbols: Record<string, PythonRuntimeSymbolRecord> = {
    'matplotlib.axes.Axes': {
      name: 'Axes',
      path: 'matplotlib.axes.Axes',
      kind: 'class',
      aliases: ['matplotlib.pyplot.Axes'],
      signature: '(*args, **kwargs)',
      doc: 'An Axes object encapsulates all the elements of an individual plot.',
      mro: ['matplotlib.axes.Axes', 'matplotlib.axes._AxesBase', 'matplotlib.artist.Artist'],
      members: {
        plot: {
          kind: 'method',
          owner: 'matplotlib.axes.Axes',
          signature: '(self, *args, scalex=True, scaley=True, data=None, **kwargs)',
          doc: 'Plot y versus x as lines and/or markers.'
        },
        scatter: {
          kind: 'method',
          owner: 'matplotlib.axes.Axes',
          signature: '(self, x, y, s=None, c=None, marker=None, **kwargs)',
          doc: 'A scatter plot of y vs. x with varying marker size and/or color.'
        },
        set_xlim: {
          kind: 'method',
          owner: 'matplotlib.axes.Axes',
          signature: '(self, left=None, right=None, *, emit=True, auto=False)',
          doc: 'Set the x-axis view limits.'
        }
      }
    },
    'matplotlib.axes._AxesBase': {
      name: '_AxesBase',
      path: 'matplotlib.axes._AxesBase',
      kind: 'class',
      aliases: ['matplotlib.axes._axes._AxesBase'],
      doc: 'Private axes base shared by Axes: grid lines and axis helpers.',
      mro: ['matplotlib.axes._AxesBase'],
      members: {
        grid: {
          kind: 'method',
          owner: 'matplotlib.axes._AxesBase',
          signature: "(self, visible=None, which='major', axis='both', **kwargs)",
          doc: 'Toggle the grid lines of the private axes base.'
        }
      }
    },
    'matplotlib.artist.Artist': {
      name: 'Artist',
      path: 'matplotlib.artist.Artist',
      kind: 'class',
      aliases: [],
      doc: 'Abstract base class for objects that render into a FigureCanvas.',
      mro: ['matplotlib.artist.Artist'],
      members: {
        get_figure: {
          kind: 'method',
          owner: 'matplotlib.artist.Artist',
          signature: '(self)',
          doc: 'Return the Figure instance the artist belongs to.'
        },
        set_label: {
          kind: 'method',
          owner: 'matplotlib.artist.Artist',
          signature: '(self, s)',
          doc: 'Set a label for this artist.'
        }
      }
    },
    'matplotlib.figure.Figure': {
      name: 'Figure',
      path: 'matplotlib.figure.Figure',
      kind: 'class',
      aliases: ['matplotlib.pyplot.Figure'],
      signature: '(figsize=None, dpi=None, **kwargs)',
      doc: 'The top level container for all the plot elements.',
      mro: ['matplotlib.figure.Figure', 'matplotlib.artist.Artist'],
      members: {
        savefig: {
          kind: 'method',
          owner: 'matplotlib.figure.Figure',
          signature: '(self, fname, *, transparent=None, **kwargs)',
          doc: 'Save the current figure.'
        }
      }
    },
    'matplotlib.pyplot.plot': {
      name: 'plot',
      path: 'matplotlib.pyplot.plot',
      kind: 'function',
      aliases: [],
      signature: '(*args, scalex=True, scaley=True, data=None, **kwargs)',
      doc: 'Plot y versus x as lines and/or markers.'
    },
    'matplotlib.pyplot.subplots': {
      name: 'subplots',
      path: 'matplotlib.pyplot.subplots',
      kind: 'function',
      aliases: [],
      signature: '(nrows=1, ncols=1, **fig_kw)',
      doc: 'Create a figure and a set of subplots.'
    }
  }

  for (let index = 0; index < 16; index += 1) {
    const name = `capability${index}`
    const path = `matplotlib.pyplot.${name}`
    symbols[path] = {
      name,
      path,
      kind: 'function',
      aliases: [],
      signature: '()',
      doc: 'capability helper for ranking checks.'
    }
  }

  const aliasIndex: Record<string, string> = {}
  for (const [path, symbol] of Object.entries(symbols)) {
    aliasIndex[path] = path
    for (const alias of symbol.aliases) {
      aliasIndex[alias] = path
    }
  }

  return {
    schemaVersion: 1,
    packageName: 'matplotlib',
    packageVersion: '3.9.2',
    pythonVersion: '3.12.1',
    moduleCount: 5,
    moduleErrors: {},
    symbols,
    aliasIndex
  }
}
