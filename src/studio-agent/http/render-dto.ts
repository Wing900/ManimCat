import type { StudioRender } from '../domain/types'

export type PublicStudioRender = Omit<StudioRender, 'ownerId'>

export function toPublicStudioRender(render: StudioRender): PublicStudioRender {
  const { ownerId: _ownerId, ...publicRender } = render
  return publicRender
}
