import { describe, expect, it } from 'vitest'
import {
  isStudioCinemaIndexReadTarget,
  planStudioCinemaSceneSelection,
} from './scene-selection-plan'

/**
 * The Scene selection plan (correction R1) is a pure rule, so its whole state machine is asserted here:
 * what is decided, and — just as important — when nothing is decided at all.
 */

const INDEX = ['scene_0001', 'scene_0002', 'scene_0003']

describe('cinema scene selection plan', () => {
  it('decides nothing while the index is not readable', () => {
    // A failed or pending read is not an empty Session: no selection, and the stored choice stays
    // exactly where the persistence gate left it.
    expect(
      planStudioCinemaSceneSelection({
        indexReadable: false,
        indexSceneIds: [],
        currentSelection: null,
        storedSceneId: 'scene_0002',
      }),
    ).toEqual({ kind: 'awaiting-index' })

    expect(
      planStudioCinemaSceneSelection({
        indexReadable: false,
        indexSceneIds: INDEX,
        currentSelection: null,
        storedSceneId: null,
      }),
    ).toEqual({ kind: 'awaiting-index' })
  })

  it('prefers a stored Scene that still exists', () => {
    expect(
      planStudioCinemaSceneSelection({
        indexReadable: true,
        indexSceneIds: INDEX,
        currentSelection: null,
        storedSceneId: 'scene_0002',
      }),
    ).toEqual({ kind: 'settled', select: 'scene_0002', reason: 'stored' })
  })

  it('falls back to the first Scene of the index when the stored one is gone', () => {
    expect(
      planStudioCinemaSceneSelection({
        indexReadable: true,
        indexSceneIds: INDEX,
        currentSelection: null,
        storedSceneId: 'scene_gone',
      }),
    ).toEqual({ kind: 'settled', select: 'scene_0001', reason: 'first' })

    expect(
      planStudioCinemaSceneSelection({
        indexReadable: true,
        indexSceneIds: INDEX,
        currentSelection: null,
        storedSceneId: null,
      }),
    ).toEqual({ kind: 'settled', select: 'scene_0001', reason: 'first' })
  })

  it('uses the index order, not the id order, for the default', () => {
    expect(
      planStudioCinemaSceneSelection({
        indexReadable: true,
        indexSceneIds: ['scene_0009', 'scene_0001'],
        currentSelection: null,
        storedSceneId: null,
      }),
    ).toEqual({ kind: 'settled', select: 'scene_0009', reason: 'first' })
  })

  it('settles on an empty but readable index without selecting anything', () => {
    expect(
      planStudioCinemaSceneSelection({
        indexReadable: true,
        indexSceneIds: [],
        currentSelection: null,
        storedSceneId: 'scene_0002',
      }),
    ).toEqual({ kind: 'settled', select: null, reason: 'empty' })
  })

  it('never fights a selection the controller already shows', () => {
    expect(
      planStudioCinemaSceneSelection({
        indexReadable: true,
        indexSceneIds: INDEX,
        currentSelection: 'scene_0003',
        storedSceneId: 'scene_0002',
      }),
    ).toEqual({ kind: 'settled', select: null, reason: 'kept' })
  })

  it('refuses an index read whose Session the controller no longer owns', () => {
    // The read carries an identity promise: it is only valid while the controller still owns that very
    // Session, so a signature cannot be used to read a Session the caller has already left.
    expect(
      isStudioCinemaIndexReadTarget({ controllerSessionId: 'session_a', expectedSessionId: 'session_a' }),
    ).toBe(true)
    expect(
      isStudioCinemaIndexReadTarget({ controllerSessionId: 'session_b', expectedSessionId: 'session_a' }),
    ).toBe(false)
    expect(
      isStudioCinemaIndexReadTarget({ controllerSessionId: null, expectedSessionId: 'session_a' }),
    ).toBe(false)
  })

  it('re-decides when the shown Scene disappeared from the index', () => {
    expect(
      planStudioCinemaSceneSelection({
        indexReadable: true,
        indexSceneIds: ['scene_0002', 'scene_0003'],
        currentSelection: 'scene_0001',
        storedSceneId: 'scene_0003',
      }),
    ).toEqual({ kind: 'settled', select: 'scene_0003', reason: 'stored' })
  })
})
