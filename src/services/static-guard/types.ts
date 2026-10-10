import type { OutputMode, PromptOverrides } from '../../types'

export type StaticCheckTool = 'py_compile'

export interface StaticDiagnostic {
  tool: StaticCheckTool
  message: string
  code?: string
  line: number
  column?: number
}

export interface StaticCheckBatch {
  diagnostics: StaticDiagnostic[]
}

export interface StaticGuardContext {
  outputMode: OutputMode
  promptOverrides?: PromptOverrides
}

export interface StaticGuardResult {
  code: string
  passes: number
}

export interface StaticPatch {
  originalSnippet: string
  replacementSnippet: string
}

export interface StaticPatchSet {
  patches: StaticPatch[]
}
