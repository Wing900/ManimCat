import type { CustomApiConfig } from '../../types'

/** Used when `CATKEY_UPSTREAM_MODEL` is unset, so a CatKey deployment is never model-less. */
const DEFAULT_CAT_KEY_UPSTREAM_MODEL = 'deepseek-v4.1-flash:1017-cloud'

/**
 * The fixed server-side upstream used by every CatKey request.
 *
 * Read from the environment on each call rather than cached at import time, so a test can set the
 * variables and so a rotated secret takes effect on restart without a second code path.
 *
 * Returns `undefined` when the deployment is incomplete; the resolver turns that into 503 rather
 * than sending a request with a blank endpoint.
 */
export function readCatKeyUpstreamConfig(): CustomApiConfig | undefined {
  const apiUrl = process.env.CATKEY_UPSTREAM_URL?.trim() ?? ''
  const apiKey = process.env.CATKEY_UPSTREAM_API_KEY?.trim() ?? ''
  const model = process.env.CATKEY_UPSTREAM_MODEL?.trim() || DEFAULT_CAT_KEY_UPSTREAM_MODEL

  if (!apiUrl || !apiKey) {
    return undefined
  }

  return { apiUrl, apiKey, model }
}
