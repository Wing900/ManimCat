import { describe, expect, it } from 'vitest'
import { hashLocalText } from './local-hash'
import { hashLocalSceneUpstreams, nextLocalTrashId, readLocalSceneFreshness } from './local-scene-state'

describe('hashLocalText', () => {
  it('is stable for the same text and changes when the text changes', () => {
    expect(hashLocalText('from scene_1 import Hero')).toBe(hashLocalText('from scene_1 import Hero'))
    expect(hashLocalText('a')).not.toBe(hashLocalText('b'))
    expect(hashLocalText('')).toHaveLength(8)
  })
})

describe('readLocalSceneFreshness', () => {
  const code = ['from scene_1 import Hero', 'class Scene(Scene):', '    pass'].join('\n')
  const upstreamCode = 'class Hero(VMobject):\n    pass'
  const sceneCodes = { scene_1: upstreamCode }
  const rendered = {
    codeHash: hashLocalText(code),
    upstreamHashes: { scene_1: hashLocalText(upstreamCode) },
  }

  it('reports UNRENDERED when there is no video on the table', () => {
    expect(readLocalSceneFreshness({ code, sceneCodes, rendered: null })).toBe('UNRENDERED')
  })

  it('reports READY when code and upstreams all match', () => {
    expect(readLocalSceneFreshness({ code, sceneCodes, rendered })).toBe('READY')
  })

  it('reports DIRTY when this Scene own code changed', () => {
    expect(readLocalSceneFreshness({ code: `${code}\n# edited`, sceneCodes, rendered })).toBe('DIRTY')
  })

  it('reports STALE when an upstream Scene changed', () => {
    expect(
      readLocalSceneFreshness({
        code,
        sceneCodes: { scene_1: `${upstreamCode}\n# upstream edited` },
        rendered,
      }),
    ).toBe('STALE')
  })

  it('reports STALE when an upstream Scene disappears', () => {
    expect(readLocalSceneFreshness({ code, sceneCodes: {}, rendered })).toBe('STALE')
  })

  it('reports STALE when a newly imported upstream Scene appears', () => {
    const widerCode = ['from scene_1 import Hero', 'from scene_2 import Prop'].join('\n')
    expect(
      readLocalSceneFreshness({
        code: widerCode,
        sceneCodes: { scene_1: upstreamCode, scene_2: 'PROP = 1\n' },
        rendered: { codeHash: hashLocalText(widerCode), upstreamHashes: { scene_1: hashLocalText(upstreamCode) } },
      }),
    ).toBe('STALE')
  })

  it('ignores a Scene it imports but cannot see', () => {
    expect(hashLocalSceneUpstreams(code, {})).toEqual({})
  })
})

describe('nextLocalTrashId', () => {
  it('numbers one past the highest, and restarts from 1 in an emptied bin', () => {
    expect(nextLocalTrashId([])).toBe(1)
    expect(nextLocalTrashId([1, 2, 3])).toBe(4)
    expect(nextLocalTrashId([1, 3])).toBe(4)
  })
})
