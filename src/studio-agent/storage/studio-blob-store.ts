import type { StudioFileAttachment } from '../domain/types'

export interface StudioBlobStore {
  kind: 'local' | 'supabase'
  resolveAttachment: (input: {
    path: string
    name?: string
    mimeType?: string
  }) => Promise<StudioFileAttachment>
}
