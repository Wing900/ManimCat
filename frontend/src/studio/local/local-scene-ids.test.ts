import { describe, expect, it } from 'vitest'
import { nextLocalSceneId, readLocalSceneImports, readLocalSceneSlot } from './local-scene-ids'

describe('local scene ids', () => {
  it('mints one past the highest number, never by count', () => {
    // A middle Scene was removed, so counting would hand out `scene_3` again and break an import.
    expect(nextLocalSceneId(['scene_1', 'scene_3'])).toBe('scene_4')
    expect(nextLocalSceneId(['scene_1', 'scene_2', 'scene_7'])).toBe('scene_8')
  })

  it('starts a fresh Session at scene_1', () => {
    expect(nextLocalSceneId([])).toBe('scene_1')
    expect(nextLocalSceneId(['session_notes'])).toBe('scene_1')
  })

  it('reads the number back, and refuses anything else', () => {
    expect(readLocalSceneSlot('scene_7')).toBe(7)
    expect(readLocalSceneSlot('scene_0007')).toBe(7)
    expect(readLocalSceneSlot('scene_0')).toBeNull()
    expect(readLocalSceneSlot('scene_deadbeef')).toBeNull()
    expect(readLocalSceneSlot('2scene')).toBeNull()
  })

  it('reads line-initial imports only, de-duplicated and sorted', () => {
    const code = [
      'from scene_2 import Hero',
      '# from scene_9 import CommentedOut',
      'from scene_1 import Stage',
      'from scene_2 import HeroAgain',
      'from math import sqrt',
      'text = "from scene_5 import NotAnImport"',
    ].join('\n')

    expect(readLocalSceneImports(code)).toEqual(['scene_1', 'scene_2'])
  })
})
