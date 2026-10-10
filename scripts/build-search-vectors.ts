/**
 * Builds the committed SearchDoc matrices: data/api-catalog/<package>/search-vectors.f32 plus the
 * index that pins their row order, width and model.
 *
 *   npm run build:search-vectors
 *
 * Every text is encoded on its own. The quantized graph derives its activation scales per call, so
 * a row's vector moves with the rows beside it; one call per row keeps the documents in the same
 * space as the single query the runtime encodes.
 */
import fs from 'node:fs/promises'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { API_RAG_PACKAGES } from '../src/services/api-rag'
import { readSearchCatalog } from '../src/services/api-rag/search-catalog'
import {
  MINI_LM_MODEL_FILE,
  createMiniLmEmbedding,
  miniLmModelDirectory
} from '../src/services/api-rag/mini-lm-embedding'
import {
  searchVectorsDataPath,
  searchVectorsIndexPath,
  type SearchVectorsIndex
} from '../src/services/api-rag/search-vectors'

const PROGRESS_EVERY = 100

async function main(): Promise<void> {
  const modelPath = path.join(miniLmModelDirectory(), MINI_LM_MODEL_FILE)
  const modelSha256 = createHash('sha256')
    .update(await fs.readFile(modelPath))
    .digest('hex')
  console.log(`model     ${path.relative(process.cwd(), modelPath)}`)
  console.log(`sha256    ${modelSha256}`)

  const embedding = createMiniLmEmbedding()
  console.log(`dimensions ${embedding.dimensions}\n`)

  for (const packageName of API_RAG_PACKAGES) {
    const catalog = readSearchCatalog(packageName)
    if (!catalog) {
      throw new Error(`Package ${packageName} has no Search Catalog to build vectors for`)
    }
    const symbols = Object.keys(catalog)
    const flat = new Float32Array(symbols.length * embedding.dimensions)

    // One call per row, in order. The first row is encoded twice to prove the result is stable.
    for (const [row, symbol] of symbols.entries()) {
      const [vector] = await embedding.embed([catalog[symbol]])
      if (vector.length !== embedding.dimensions) {
        throw new Error(`${symbol} produced ${vector.length} dimensions, expected ${embedding.dimensions}`)
      }
      flat.set(vector, row * embedding.dimensions)
      if (row === 0 && symbols.length > 1) {
        const [again] = await embedding.embed([catalog[symbol]])
        const bytesOf = (values: Float32Array): Buffer =>
          Buffer.from(values.buffer, values.byteOffset, values.byteLength)
        if (Buffer.compare(bytesOf(vector), bytesOf(again)) !== 0) {
          throw new Error(`Encoding ${symbol} twice returned different vectors: batch 1 is not stable`)
        }
      }
      if ((row + 1) % PROGRESS_EVERY === 0 || row === symbols.length - 1) {
        console.log(`  ${packageName}: ${row + 1}/${symbols.length}`)
      }
    }

    const index: SearchVectorsIndex = {
      dimensions: embedding.dimensions,
      modelSha256,
      symbols
    }
    const dataPath = searchVectorsDataPath(packageName)
    const indexPath = searchVectorsIndexPath(packageName)
    await fs.writeFile(dataPath, Buffer.from(flat.buffer, flat.byteOffset, flat.byteLength))
    await fs.writeFile(indexPath, `${JSON.stringify(index, null, 2)}\n`, 'utf8')
    console.log(
      `\n${packageName}: ${symbols.length} rows → ` +
        `${path.relative(process.cwd(), dataPath)} (${flat.byteLength} bytes)\n`
    )
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})
