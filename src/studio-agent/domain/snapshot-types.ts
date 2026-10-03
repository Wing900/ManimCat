import type { StudioRender, StudioRun, StudioScene, StudioSession } from './core-types'
import type { StudioMessage } from './message-types'

export interface StudioSessionSnapshot {
  session: StudioSession
  messages: StudioMessage[]
  runs: StudioRun[]
  renders: StudioRender[]
  /** Ordered Scenes; empty for legacy Sessions that never created one. */
  scenes: StudioScene[]
}

/**
 * One Scene and only its own records: the read model a Scene-scoped Thread consumes.
 * `messages`/`runs`/`renders` never contain legacy Session-scoped records.
 */
export interface StudioSceneSnapshot {
  scene: StudioScene
  messages: StudioMessage[]
  runs: StudioRun[]
  renders: StudioRender[]
}
