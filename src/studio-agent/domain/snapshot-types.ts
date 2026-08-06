import type { StudioRender, StudioRun, StudioSession } from './core-types'
import type { StudioMessage } from './message-types'

export interface StudioSessionSnapshot {
  session: StudioSession
  messages: StudioMessage[]
  runs: StudioRun[]
  renders: StudioRender[]
}
