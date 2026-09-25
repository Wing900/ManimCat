export interface ManimApiRequest {
  query: string
  symbols: string[]
}

export interface ManimApiResult {
  status: 'found' | 'not_found' | 'unavailable'
  query: string
  symbols: string[]
  content: string
  cached: boolean
}

export interface ManimApiProvider {
  lookup(request: ManimApiRequest): Promise<ManimApiResult>
}

export interface RuntimeMemberRecord {
  kind: 'property' | 'staticmethod' | 'classmethod' | 'method' | 'attribute'
  owner: string
  signature?: string
  doc?: string
}

export interface RuntimeSymbolRecord {
  name: string
  path: string
  kind: 'class' | 'function' | 'module' | 'constant'
  aliases: string[]
  signature?: string
  doc?: string
  value?: string
  mro?: string[]
  members?: Record<string, RuntimeMemberRecord>
}

export interface RuntimeManimCatalog {
  schemaVersion: number
  manimVersion: string
  pythonVersion: string
  moduleCount: number
  moduleErrors: Record<string, string>
  symbols: Record<string, RuntimeSymbolRecord>
  aliasIndex: Record<string, string>
}
