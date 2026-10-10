import type { StudioRun } from '../domain/types'

export type PublicStudioRun = Omit<StudioRun, 'ownerId'>

export function toPublicStudioRun(run: StudioRun): PublicStudioRun {
  const { ownerId: _ownerId, ...publicRun } = run
  return publicRun
}
