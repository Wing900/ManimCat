import { createLogger } from '../shared/logging/logger'
import type { CustomApiConfig } from '../types'

const logger = createLogger('ManimcatRouting')

function splitListInput(input: string | undefined): string[] {
  if (!input) {
    return []
  }

  return input
    .split(/[\n,]/g)
    .map((item) => item.trim())
}

function valueByIndex(values: string[], index: number): string {
  if (values.length === 0) {
    return ''
  }
  if (values.length === 1) {
    return values[0]
  }
  return values[index] || ''
}

function loadRoutingTable(): Map<string, CustomApiConfig> {
  const keys = splitListInput(process.env.MANIMCAT_ROUTE_KEYS)
  const apiUrls = splitListInput(process.env.MANIMCAT_ROUTE_API_URLS)
  const apiKeys = splitListInput(process.env.MANIMCAT_ROUTE_API_KEYS)
  const models = splitListInput(process.env.MANIMCAT_ROUTE_MODELS)

  const table = new Map<string, CustomApiConfig>()
  for (let i = 0; i < keys.length; i += 1) {
    const key = keys[i]
    if (!key) {
      continue
    }

    const apiUrl = valueByIndex(apiUrls, i)
    const apiKey = valueByIndex(apiKeys, i)
    const model = valueByIndex(models, i)

    if (!apiUrl || !apiKey) {
      logger.warn('Skip invalid MANIMCAT route entry: missing apiUrl/apiKey', {
        keyPrefix: `${key.slice(0, 4)}...`,
        index: i
      })
      continue
    }

    if (table.has(key)) {
      logger.warn('Duplicate MANIMCAT route key, latest entry wins', {
        keyPrefix: `${key.slice(0, 4)}...`,
        index: i
      })
    }

    if (!model) {
      logger.warn('MANIMCAT route entry has empty model', {
        keyPrefix: `${key.slice(0, 4)}...`,
        index: i
      })
    }

    table.set(key, { apiUrl, apiKey, model })
  }

  if (table.size > 0) {
    logger.info('Loaded MANIMCAT route table', { profiles: table.size })
  }

  return table
}

const routingTable = loadRoutingTable()

export function resolveCustomApiConfigByManimcatKey(
  manimcatApiKey: string | undefined
): CustomApiConfig | undefined {
  if (!manimcatApiKey) {
    return undefined
  }
  return routingTable.get(manimcatApiKey.trim())
}

export function getManimcatRouteStats(): { profiles: number; enabledModels: number } {
  let enabledModels = 0
  for (const config of routingTable.values()) {
    if (config.model && config.model.trim()) {
      enabledModels += 1
    }
  }
  return { profiles: routingTable.size, enabledModels }
}
