/**
 * Package-neutral runtime catalog types for any Python-backed Studio.
 *
 * A catalog is produced by a trusted generator script and describes the installed
 * runtime; it never describes user input.
 */

export interface PythonRuntimeMemberRecord {
  kind: 'property' | 'staticmethod' | 'classmethod' | 'method' | 'attribute'
  owner: string
  signature?: string
  doc?: string
}

export interface PythonRuntimeSymbolRecord {
  name: string
  path: string
  kind: 'class' | 'function' | 'module' | 'constant'
  aliases: string[]
  signature?: string
  doc?: string
  value?: string
  mro?: string[]
  members?: Record<string, PythonRuntimeMemberRecord>
}

export interface PythonRuntimeCatalog {
  schemaVersion: 1
  packageName: string
  packageVersion: string
  pythonVersion: string
  moduleCount: number
  moduleErrors: Record<string, string>
  symbols: Record<string, PythonRuntimeSymbolRecord>
  aliasIndex: Record<string, string>
}
