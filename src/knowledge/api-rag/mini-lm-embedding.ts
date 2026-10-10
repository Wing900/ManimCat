import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { Tokenizer } from '@huggingface/tokenizers'
import type { Encoding } from '@huggingface/tokenizers'
import { InferenceSession, Tensor, env } from 'onnxruntime-web'
import type { EmbeddingModel } from './types'

/** all-MiniLM-L6-v2 INT8, shipped with the deployment. Never downloaded at runtime. */
export const MINI_LM_MODEL_ID = 'all-MiniLM-L6-v2'
/** `hidden_size` of the model config, and therefore the width of every stored vector. */
export const MINI_LM_DIMENSIONS = 384
/** The only graph the deployment ships, and the only one this runtime loads. */
export const MINI_LM_MODEL_FILE = 'onnx/model_quantized.onnx'

export function miniLmModelDirectory(): string {
  return path.join(process.cwd(), 'data', 'models', MINI_LM_MODEL_ID)
}

/**
 * The wasm build of ONNX Runtime, resolved from the installed package. A missing
 * directory fails the import here; runtime never falls back to a CDN.
 */
function onnxRuntimeWasmDirectory(): string {
  return path.join(process.cwd(), 'node_modules', 'onnxruntime-web', 'dist')
}

/** The local inference runtime. One model, one session, one tokenizer. */
export type MiniLmRuntime = EmbeddingModel

function readJson(file: string): object {
  return JSON.parse(fs.readFileSync(file, 'utf8')) as object
}

/**
 * Mean-pools the hidden states over the attention mask and normalizes the result.
 * Same arithmetic as the reference `mean_pooling`, without a second dependency.
 */
function poolRow(hidden: Float32Array, mask: number[], width: number, dimensions: number): Float32Array {
  const vector = new Float32Array(dimensions)
  let counted = 0
  for (let token = 0; token < width; token += 1) {
    if (!mask[token]) {
      continue
    }
    counted += 1
    const offset = token * dimensions
    for (let d = 0; d < dimensions; d += 1) {
      vector[d] += hidden[offset + d]
    }
  }
  let norm = 0
  for (let d = 0; d < dimensions; d += 1) {
    vector[d] /= counted
    norm += vector[d] * vector[d]
  }
  norm = Math.sqrt(norm)
  for (let d = 0; d < dimensions; d += 1) {
    vector[d] /= norm
  }
  return vector
}

/**
 * Encodes one text per session run. The INT8 graph quantizes its activations per call, so
 * a row's vector depends on the rows beside it: the same text scores 0.988 against itself
 * in a batch of 24, and 0.994 in a batch of 2. One row per call keeps every document and
 * every query in the same space, which is the only property retrieval needs.
 */
async function embedTexts(
  session: InferenceSession,
  tokenizer: Tokenizer,
  texts: readonly string[]
): Promise<Float32Array[]> {
  const dimensions = MINI_LM_DIMENSIONS
  const vectors: Float32Array[] = []
  for (const text of texts) {
    const entry: Encoding = tokenizer.encode(text)
    const width = entry.ids.length
    const output = await session.run({
      input_ids: new Tensor('int64', BigInt64Array.from(entry.ids, (id) => BigInt(id)), [1, width]),
      attention_mask: new Tensor(
        'int64',
        BigInt64Array.from(entry.attention_mask, (weight) => BigInt(weight)),
        [1, width]
      ),
      token_type_ids: new Tensor('int64', new BigInt64Array(width), [1, width])
    })
    const hidden = output[session.outputNames[0]]
    vectors.push(poolRow(hidden.data as Float32Array, entry.attention_mask, width, dimensions))
  }
  return vectors
}

/**
 * Loads the local MiniLM session: the WordPiece tokenizer and the quantized ONNX graph,
 * both read from `modelDirectory`. Nothing here reaches the network.
 */
export async function loadMiniLmRuntime(modelDirectory: string): Promise<MiniLmRuntime> {
  const tokenizer = new Tokenizer(
    readJson(path.join(modelDirectory, 'tokenizer.json')),
    readJson(path.join(modelDirectory, 'tokenizer_config.json'))
  )
  env.wasm.wasmPaths = pathToFileURL(onnxRuntimeWasmDirectory() + path.sep).href
  env.wasm.numThreads = 1
  const session = await InferenceSession.create(path.join(modelDirectory, MINI_LM_MODEL_FILE), {
    executionProviders: ['wasm'],
    graphOptimizationLevel: 'all'
  })

  return {
    dimensions: MINI_LM_DIMENSIONS,
    async embed(texts) {
      if (texts.length === 0) {
        return []
      }
      return embedTexts(session, tokenizer, texts)
    }
  }
}

/**
 * The product's embedding model. The runtime loads on first use and stays in the
 * process for its lifetime.
 */
export function createMiniLmEmbedding(options?: {
  modelDirectory?: string
  runtime?: MiniLmRuntime
}): EmbeddingModel {
  const modelDirectory = options?.modelDirectory ?? miniLmModelDirectory()
  let runtimePromise: Promise<MiniLmRuntime> | undefined

  const runtime = (): Promise<MiniLmRuntime> => {
    if (options?.runtime) {
      return Promise.resolve(options.runtime)
    }
    if (!runtimePromise) {
      runtimePromise = loadMiniLmRuntime(modelDirectory).catch((error: unknown) => {
        runtimePromise = undefined
        throw error
      })
    }
    return runtimePromise
  }

  return {
    dimensions: MINI_LM_DIMENSIONS,
    async embed(texts) {
      const model = await runtime()
      return model.embed(texts)
    }
  }
}
