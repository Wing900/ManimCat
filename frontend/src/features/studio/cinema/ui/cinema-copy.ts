import type { TranslationKey } from '../../../../shared/i18n/index'
import type { StudioKind } from '../../protocol/studio-agent-types'

/**
 * Cinema copy keys that name the studio's unit noun.
 *
 * The Manim Studio calls the unit a "Scene"; the Plot Studio calls it a "图片"/"image", because one
 * Scene is one rendered matplotlib figure there. Every key below must exist twice:
 * `studio.cinema.<key>` (manim) and `studio.cinema.plot.<key>` (plot); the resolver is typed, so a
 * missing twin fails the build instead of silently falling back to the other noun.
 */
export type CinemaUnitKey =
  | 'sceneLabel'
  | 'sceneStripLabel'
  | 'sceneAppend'
  | 'scenePickerLabel'
  | 'scenePickerAll'
  | 'scenePrev'
  | 'sceneNext'
  | 'sceneEmptyTitle'
  | 'sceneCreateFirst'
  | 'initializeProgress'
  | 'initializeContinue'
  | 'catEntryLabel'
  | 'catWorking'
  | 'logoUsageLabel'
  | 'logoUsageTitle'
  | 'logoUsageScope'
  | 'historyTitle'
  | 'submitBlockedLoading'
  | 'submitBlockedSnapshotFailed'
  | 'submitBlockedActiveRun'
  | 'screenLabel'
  | 'screenResultAlt'
  | 'feedbackSceneCreateFailed'
  | 'feedbackSceneCreateUnknown'
  | 'feedbackInitializePartial'
  | 'feedbackRunSubmitConflict'
  | 'feedbackSnapshotFailed'

/** Resolve the per-kind translation key for a unit-noun label. */
export function cinemaUnitKey(kind: StudioKind, key: CinemaUnitKey): TranslationKey {
  return kind === 'matplotlib' ? `studio.cinema.plot.${key}` : `studio.cinema.${key}`
}
