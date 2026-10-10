import path from 'node:path'
import { env, pipeline } from '@huggingface/transformers'
import type { EmbeddingModel } from './types'

/** all-MiniLM-L6-v2 INT8, shipped with the deployment. Never downloaded at runtime. */
export const MINI_LM_MODEL_ID = 'all-MiniLM-L6-v2'
/** `hidden_size` of the model config, and therefore the width of every stored vector. */
export const MINI_LM_DIMENSIONS = 384

export function miniLmModelDirectory(): string {
  return path.join(process.cwd(), 'data', 'models', MINI_LM_MODEL_ID)
}

/** The local inference runtime. One model, one session, one tokenizer. */
export type MiniLmRuntime = EmbeddingModel

/**
 * Loads the local MiniLM session: config, tokenizer and the quantized ONNX graph read
 * from `modelDirectory`. Remote loading stays off, so a missing model file fails here
 * instead of silently reaching for the network.
 *
 * Tokenization, attention masks, mean pooling and normalization are the official
 * transformers.js implementations; this module only fixes the parameters.
 */
export async function loadMiniLmRuntime(modelDirectory: string): Promise<MiniLmRuntime> {
  env.allowRemoteModels = false
  env.allowLocalModels = true
  env.useBrowserCache = false
  env.localModelPath = path.dirname(modelDirectory)

  const extractor = await pipeline('feature-extraction', path.basename(modelDirectory), {
    dtype: 'q8',
    device: 'cpu'
  })

  return {
    dimensions: MINI_LM_DIMENSIONS,
    async embed(texts) {
      if (texts.length === 0) {
        return []
      }
      const output = await extractor([...texts], { pooling: 'mean', normalize: true })
      return (output.tolist() as number[][]).map((row) => Float32Array.from(row))
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
