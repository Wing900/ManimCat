import type { StudioKind } from '../domain/types'
import type { StudioDocumentationKey } from '../modes/studio-mode'

export interface StudioDocumentationContextRequest {
  studioKind: StudioKind
  documentationKey: StudioDocumentationKey
  task: string
  workspaceDirectory?: string
  files?: string[]
}

export interface StudioDocumentationContextProvider {
  getContext: (input: StudioDocumentationContextRequest) => Promise<string | undefined>
}

export function createEmptyStudioDocumentationContextProvider(): StudioDocumentationContextProvider {
  return {
    async getContext() {
      return undefined
    }
  }
}
