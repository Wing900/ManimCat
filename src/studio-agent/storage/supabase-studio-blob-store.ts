import type { SupabaseClient } from '@supabase/supabase-js'
import type { StudioBlobStore } from './studio-blob-store'

interface CreateSupabaseStudioBlobStoreInput {
  client: SupabaseClient
  bucket: string
}

export function createSupabaseStudioBlobStore(input: CreateSupabaseStudioBlobStoreInput): StudioBlobStore {
  return {
    kind: 'supabase',
    async resolveAttachment(attachment) {
      if (isAbsoluteUrl(attachment.path)) {
        return {
          kind: 'file',
          path: attachment.path,
          name: attachment.name,
          mimeType: attachment.mimeType,
        }
      }

      const storageKey = normalizeStorageKey(attachment.path)
      const { data } = input.client.storage.from(input.bucket).getPublicUrl(storageKey)

      return {
        kind: 'file',
        path: data.publicUrl,
        name: attachment.name,
        mimeType: attachment.mimeType,
      }
    },
  }
}

function isAbsoluteUrl(value: string): boolean {
  return /^https?:\/\//i.test(value)
}

function normalizeStorageKey(value: string): string {
  return value.replace(/^\/+/, '')
}
