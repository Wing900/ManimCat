import type { StudioKind } from '../domain/types'

export interface StudioDocumentationContextRequest {
  kind: StudioKind
  query: string
  maxChars: number
}

export interface StudioDocumentationContextProvider {
  getContext: (input: StudioDocumentationContextRequest) => Promise<string>
}

export function createEmptyStudioDocumentationContextProvider(): StudioDocumentationContextProvider {
  return {
    async getContext() {
      return ''
    }
  }
}

export async function loadStudioDocumentationContext(
  provider: StudioDocumentationContextProvider,
  input: StudioDocumentationContextRequest,
): Promise<string> {
  try {
    const context = await provider.getContext(input)
    return context.trim().slice(0, input.maxChars)
  } catch {
    return ''
  }
}
