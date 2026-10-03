import { describe, expect, it } from 'vitest'
import {
  CAT_REPLY_SNIPPET_MAX_CHARS,
  readStudioCinemaCatFeedback,
  readStudioCinemaCatReplySnippet,
} from './cat-feedback'

describe('readStudioCinemaCatReplySnippet', () => {
  it('repeats the opening of a real reply and marks it as unfinished', () => {
    expect(readStudioCinemaCatReplySnippet('A circle rolling along a line')).toBe('A circle rolling along a…')
  })

  it('keeps a short reply whole, still ending on an ellipsis', () => {
    expect(readStudioCinemaCatReplySnippet('Done')).toBe('Done…')
  })

  it('flattens markdown and line breaks so the bubble reads as speech', () => {
    expect(readStudioCinemaCatReplySnippet('## First\n\n**Draw** a   circle')).toBe('First Draw a circle…')
  })

  it('never exceeds the bubble budget', () => {
    const snippet = readStudioCinemaCatReplySnippet('x'.repeat(200))
    expect(Array.from(snippet)).toHaveLength(CAT_REPLY_SNIPPET_MAX_CHARS + 1)
  })

  it('stays empty when there is nothing to repeat (caller stays quiet, never an empty bubble)', () => {
    expect(readStudioCinemaCatReplySnippet('   \n\n')).toBe('')
    expect(readStudioCinemaCatReplySnippet('###')).toBe('')
  })
})

describe('readStudioCinemaCatFeedback', () => {
  it('reports nothing for the states a real reply already carries', () => {
    expect(readStudioCinemaCatFeedback('studio.cinema.catIdle')).toBeNull()
    expect(readStudioCinemaCatFeedback('studio.cinema.catSubmitting')).toBeNull()
    expect(readStudioCinemaCatFeedback('studio.cinema.catWorking')).toBeNull()
  })

  it('reports states the assistant cannot state itself, with a recover entry', () => {
    const failed = readStudioCinemaCatFeedback('studio.cinema.catFailed')
    expect(failed?.kind).toBe('persistent')
    expect(failed?.hasRecoverEntry).toBe(true)
    expect(readStudioCinemaCatFeedback('studio.cinema.catNeedsCheck')?.hasRecoverEntry).toBe(true)
    expect(readStudioCinemaCatFeedback('studio.cinema.catUnreachable')?.hasRecoverEntry).toBe(true)
    expect(readStudioCinemaCatFeedback('studio.cinema.catRefreshPaused')?.hasRecoverEntry).toBe(true)
  })

  it('keeps a reconnect as persistent but without a recover entry (the cat is handling it)', () => {
    const reconnect = readStudioCinemaCatFeedback('studio.cinema.catReconnecting')
    expect(reconnect?.kind).toBe('persistent')
    expect(reconnect?.hasRecoverEntry).toBe(false)
  })

  it('never invents a sentence for an unknown status', () => {
    expect(readStudioCinemaCatFeedback('studio.cinema.catNotAState' as never)).toBeNull()
  })
})
