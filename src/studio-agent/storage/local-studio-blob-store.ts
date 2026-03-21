import type { StudioBlobStore } from './studio-blob-store'

export function createLocalStudioBlobStore(): StudioBlobStore {
  return {
    kind: 'local',
    async resolveAttachment(input) {
      return {
        kind: 'file',
        path: input.path,
        name: input.name,
        mimeType: input.mimeType,
      }
    },
  }
}
