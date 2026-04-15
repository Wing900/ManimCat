import { describe, expect, it } from 'vitest'
import {
  getStudioCommandSuggestions,
  getStudioSkillSuggestions,
} from '../../../studio/commands/autocomplete/command-suggestions'

describe('getStudioCommandSuggestions', () => {
  it('returns registered commands when the user types slash', () => {
    const suggestions = getStudioCommandSuggestions('/')

    expect(suggestions.map((item) => item.trigger)).toContain('/history')
    expect(suggestions.map((item) => item.trigger)).toContain('/new')
    expect(suggestions.map((item) => item.trigger)).toContain('/safe')
    expect(suggestions.map((item) => item.trigger)).toContain('/p')
    expect(suggestions.map((item) => item.trigger)).toContain('/skill')
  })

  it('filters suggestions by prefix', () => {
    const suggestions = getStudioCommandSuggestions('/n')

    expect(suggestions.map((item) => item.trigger)).toEqual(['/new'])
  })

  it('includes separately registered permission mode commands', () => {
    const suggestions = getStudioCommandSuggestions('/a')

    expect(suggestions.map((item) => item.trigger)).toEqual(['/auto'])
  })

  it('suggests the skill command by prefix', () => {
    const suggestions = getStudioCommandSuggestions('/sk')

    expect(suggestions.map((item) => item.trigger)).toEqual(['/skill'])
  })

  it('expands actual skill names for /skill input', () => {
    const suggestions = getStudioSkillSuggestions('/skill math', [
      {
        name: 'math-education-visualization',
        description: 'Math teaching visualization skill.',
        scope: 'common',
        directory: 'D:/skills/math-education-visualization',
        entryFile: 'D:/skills/math-education-visualization/SKILL.md',
        source: 'catalog',
      },
    ])

    expect(suggestions).toEqual([
      expect.objectContaining({
        trigger: 'math-education-visualization',
        inputValue: '/skill math-education-visualization',
      }),
    ])
  })
})
