import assert from 'node:assert/strict'
import { createBaselineResolver } from '../../../services/api-rag/baseline-resolver'
import {
  baselineCatalogPath,
  loadBaselineCatalog,
  searchCatalogPath,
  validateBaselineCatalog
} from '../../../services/api-rag/baseline-catalog'
import { createCosineRetriever, l2Normalize } from '../../../services/api-rag/cosine-retriever'
import { ApiRagService } from '../../../services/api-rag/api-rag-service'
import {
  assertSearchCatalogResolvable,
  readSearchCatalog,
  validateSearchCatalog
} from '../../../services/api-rag/search-catalog'
import { API_RAG_TOP_K, type EmbeddingModel } from '../../../services/api-rag/types'
import { createStudioSearchApiTool, SEARCH_API_TOOL_NAME } from '../../tools/search-api-tool'
import { run } from './factories'

const DIMENSIONS = 8

/** Deterministic stand-in for MiniLM: same text, same vector, no model needed. */
function createDeterministicEmbedding(): EmbeddingModel {
  return {
    dimensions: DIMENSIONS,
    async embed(texts) {
      return texts.map((text) => {
        const vector = new Float32Array(DIMENSIONS)
        for (let index = 0; index < text.length; index += 1) {
          vector[index % DIMENSIONS] += text.charCodeAt(index) / 255
        }
        return vector
      })
    }
  }
}



export async function runApiRagTests(): Promise<void> {
  await run('baseline catalog loads from data/api-catalog and matches its package', async () => {
    const catalog = await loadBaselineCatalog('manim')
    assert.equal(catalog.packageName, 'manim')
    assert.ok(catalog.symbols['manim.MathTex'], 'canonical symbol must be indexed')
    assert.ok(Object.keys(catalog.symbols).length > 1000)
    assert.match(baselineCatalogPath('manim').replace(/\\/g, '/'), /data\/api-catalog\/manim\/baseline\.json$/)
  })

  await run('baseline validation rejects a malformed schema', async () => {
    assert.throws(() => validateBaselineCatalog({ symbols: {}, aliasIndex: {} }, 'manim'), /invalid schema/)
    assert.throws(
      () => validateBaselineCatalog({
        schemaVersion: 1,
        packageName: 'manim',
        packageVersion: '1',
        pythonVersion: '3',
        moduleCount: 1,
        moduleErrors: {},
        symbols: { 'manim.Bad': { name: 'Bad', path: 'manim.Bad', kind: 'nonsense', aliases: [] } },
        aliasIndex: {}
      }, 'manim'),
      /kind nonsense/
    )
  })

  await run('baseline resolver answers exact, alias, short name and member references', async () => {
    const catalog = await loadBaselineCatalog('manim')
    const resolver = createBaselineResolver(catalog)

    const exact = resolver.verify('manim.MathTex')
    assert.equal(exact.verdict, 'FOUND')
    assert.equal(exact.canonicalSymbol, 'manim.MathTex')

    const shortName = resolver.verify('MathTex')
    assert.equal(shortName.canonicalSymbol, 'manim.MathTex')

    const alias = Object.entries(catalog.aliasIndex)[0]
    assert.ok(alias, 'the catalog must carry aliases')
    assert.equal(resolver.verify(alias[0]).canonicalSymbol, alias[1])

    const member = resolver.verify('manim.Axes.add_coordinates')
    assert.equal(member.verdict, 'FOUND')
    // `owner` is the class that declares the member, spelled the way the module tree spells it,
    // and it resolves back to the same class through the alias index.
    assert.equal(member.owner, 'manim.mobject.graphing.coordinate_systems.CoordinateSystem')
    assert.equal(resolver.verify(member.owner ?? '').canonicalSymbol, 'manim.CoordinateSystem')

    assert.deepEqual(resolver.verify('manim.NoSuchApiAtAll'), {
      requested: 'manim.NoSuchApiAtAll',
      verdict: 'NOT_FOUND'
    })
  })

  await run('every SearchDoc key resolves in the Baseline', async () => {
    const catalog = await loadBaselineCatalog('manim')
    const resolver = createBaselineResolver(catalog)
    const searchCatalog = readSearchCatalog('manim')
    assert.ok(searchCatalog)

    assert.ok(Object.keys(searchCatalog).length > 500)
    assertSearchCatalogResolvable(searchCatalog, resolver, 'manim')

    assert.throws(
      () => assertSearchCatalogResolvable({ 'manim.NoSuchApiAtAll': 'invent an api' }, resolver, 'manim'),
      /unresolvable keys/
    )
    assert.throws(() => validateSearchCatalog({ 'manim.MathTex': '   ' }, 'manim'), /empty sentence/)
  })

  await run('Search Catalog registration is driven by the committed data', async () => {
    assert.ok(readSearchCatalog('manim'))
    assert.ok(readSearchCatalog('matplotlib'))
    assert.match(searchCatalogPath('manim').replace(/\\/g, '/'), /data\/api-catalog\/manim\/search\.json$/)
    assert.match(searchCatalogPath('matplotlib').replace(/\\/g, '/'), /data\/api-catalog\/matplotlib\/search\.json$/)

    const service = new ApiRagService({
      embedding: createDeterministicEmbedding(),
      packages: ['manim', 'matplotlib']
    })
    assert.deepEqual(service.registeredPackages, ['manim', 'matplotlib'])
    await service.ready()
    const plot = await service.search('matplotlib', { query: 'draw a line' })
    assert.equal(plot.packageName, 'matplotlib')
    assert.equal(plot.candidates.length, API_RAG_TOP_K)

    // A package whose catalog file is absent is simply not registered.
    const single = new ApiRagService({
      embedding: createDeterministicEmbedding(),
      packages: ['manim']
    })
    assert.deepEqual(single.registeredPackages, ['manim'])
    assert.equal(single.isRegistered('matplotlib'), false)
    await assert.rejects(() => single.search('matplotlib', { query: 'draw a line' }), /not registered/)
  })

  await run('cosine retriever normalizes, ranks and rejects a dimension mismatch', async () => {
    const retriever = createCosineRetriever([
      { symbol: 'a', searchDoc: 'first', embedding: new Float32Array([1, 0]) },
      { symbol: 'b', searchDoc: 'second', embedding: new Float32Array([0.9, 0.1]) },
      { symbol: 'c', searchDoc: 'third', embedding: new Float32Array([0, 1]) }
    ], 2)

    const hits = retriever.search(new Float32Array([1, 0]), 2)
    assert.deepEqual(hits.map((hit) => hit.symbol), ['a', 'b'])
    assert.ok(hits[0].score > hits[1].score)
    assert.ok(Math.abs(l2Normalize(new Float32Array([3, 4]))[0] - 0.6) < 1e-6)
    assert.throws(() => retriever.search(new Float32Array([1, 0, 0]), 2), /dimension mismatch/)
    assert.throws(
      () => createCosineRetriever([{ symbol: 'a', searchDoc: 'x', embedding: new Float32Array([1]) }], 2),
      /dimension mismatch/
    )
  })

  await run('api rag service verifies named symbols and augments recalled candidates', async () => {
    const service = new ApiRagService({
      embedding: createDeterministicEmbedding(),
      packages: ['manim']
    })
    await service.ready()

    const result = await service.search('manim', {
      query: 'add numeric labels to coordinate axes',
      symbols: ['Axes.add_coordinates', 'NoSuchApiAtAll']
    })

    assert.equal(result.packageName, 'manim')
    assert.equal(result.verification[0].verdict, 'FOUND')
    assert.equal(result.verification[1].verdict, 'NOT_FOUND')
    assert.equal(result.candidates.length, API_RAG_TOP_K)
    assert.deepEqual(result.candidates.map((candidate) => candidate.rank).slice(0, 3), [1, 2, 3])
    for (const candidate of result.candidates) {
      assert.ok(candidate.symbol.startsWith('manim.'), `candidate symbol must be canonical: ${candidate.symbol}`)
      assert.equal(typeof candidate.searchDoc, 'string')
      assert.equal(typeof candidate.score, 'number')
      assert.notEqual(candidate.kind, 'unknown')
    }

    await assert.rejects(() => service.search('manim', { query: '   ' }), /non-empty query/)
  })

  await run('a name several APIs share is answered as AMBIGUOUS, never as FOUND', async () => {
    const catalog = await loadBaselineCatalog('matplotlib')
    const resolver = createBaselineResolver(catalog)

    // matplotlib.artist.get and matplotlib.pyplot.get rank identically, so no rule may pick one.
    const shared = resolver.verify('get')
    assert.equal(shared.verdict, 'AMBIGUOUS')
    assert.deepEqual(shared.candidates, ['matplotlib.artist.get', 'matplotlib.pyplot.get'])
    assert.equal(shared.canonicalSymbol, undefined)

    // A class and a function that share a name are ambiguous; an exact path never is.
    assert.equal(resolver.verify('axes').verdict, 'AMBIGUOUS')
    assert.deepEqual(resolver.verify('axes').candidates, [
      'matplotlib.axes.Axes',
      'matplotlib.pyplot.axes'
    ])
    assert.equal(resolver.verify('matplotlib.axes').verdict, 'FOUND')
    assert.equal(resolver.verify('matplotlib.axes').canonicalSymbol, 'matplotlib.axes')

    // A class still beats the module that shares its lowercase name, so Manim stays unambiguous.
    const manim = createBaselineResolver(await loadBaselineCatalog('manim'))
    assert.equal(manim.verify('axes').verdict, 'FOUND')
    assert.equal(manim.verify('axes').canonicalSymbol, 'manim.Axes')
  })

  await run('the search_api tool passes structured JSON to the Builder', async () => {
    const service = new ApiRagService({
      embedding: createDeterministicEmbedding(),
      packages: ['manim']
    })
    const tool = createStudioSearchApiTool({ service, packageName: 'manim', studioKind: 'manim' })
    assert.equal(tool.name, SEARCH_API_TOOL_NAME)
    assert.deepEqual(tool.allowedStudioKinds, ['manim'])
    assert.deepEqual(tool.allowedAgents, ['builder'])

    const result = await tool.execute({ query: 'draw a circle', symbols: ['Circle'] }, {} as never)
    const payload = JSON.parse(result.output) as { verification: Array<{ verdict: string }>; candidates: unknown[] }
    assert.equal(payload.verification[0].verdict, 'FOUND')
    assert.equal(payload.candidates.length, API_RAG_TOP_K)
    assert.equal(result.metadata?.verified, 1)
    assert.equal(result.metadata?.ambiguous, 0)
    assert.equal(result.metadata?.notFound, 0)

    const ambiguous = await tool.execute({ query: 'draw', symbols: ['SALMON'] }, {} as never)
    const ambiguousPayload = JSON.parse(ambiguous.output) as { verification: Array<{ verdict: string }> }
    assert.equal(ambiguousPayload.verification[0].verdict, 'AMBIGUOUS')
    assert.equal(ambiguous.metadata?.verified, 0)
    assert.equal(ambiguous.metadata?.ambiguous, 1)
    assert.equal(ambiguous.metadata?.notFound, 0)

    await assert.rejects(() => tool.execute({ query: '  ' }, {} as never), /non-empty query/)
  })
}
