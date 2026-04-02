import type {
  StudioTask,
  StudioWork,
  StudioWorkResult,
} from '../protocol/studio-agent-types'

export interface PlotWorkListItem {
  work: StudioWork
  latestTask: StudioTask | null
  result: StudioWorkResult | null
}

export type PlotPreviewVariant = 'default' | 't-layout-top' | 'pure-minimal-top'
