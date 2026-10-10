import type { VisionImageDetail } from '../../../shared/types/api'

export interface StudioComposerAttachmentBase {
  id: string
  kind: 'image'
  name: string
  tokenLabel: string
}

export interface StudioComposerImageAttachment extends StudioComposerAttachmentBase {
  kind: 'image'
  url: string
  previewUrl: string
  detail?: VisionImageDetail
  mimeType?: string
}

export type StudioComposerAttachment = StudioComposerImageAttachment
