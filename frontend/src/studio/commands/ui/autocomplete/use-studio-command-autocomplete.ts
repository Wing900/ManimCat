import type { KeyboardEvent as ReactKeyboardEvent } from 'react'
import { useEffect, useMemo, useState } from 'react'
import { getStudioSessionSkills } from '../../../api/studio-agent-api'
import type { StudioSession } from '../../../protocol/studio-agent-types'
import {
  getStudioCommandSuggestions,
  getStudioSkillSuggestions,
  type StudioCommandSuggestion,
} from '../../autocomplete/command-suggestions'

export function useStudioCommandAutocomplete(input: string, session: StudioSession | null) {
  const [activeSuggestionIndex, setActiveSuggestionIndex] = useState(0)
  const [skillSuggestions, setSkillSuggestions] = useState<StudioCommandSuggestion[]>([])
  const commandSuggestions = useMemo(() => getStudioCommandSuggestions(input), [input])

  useEffect(() => {
    let cancelled = false

    const loadSkillSuggestions = async () => {
      if (!session || !/^\/skill(?:\s+.*)?$/i.test(input.trim())) {
        setSkillSuggestions([])
        return
      }

      try {
        const skills = await getStudioSessionSkills(session.id)
        if (!cancelled) {
          setSkillSuggestions(getStudioSkillSuggestions(input, skills))
        }
      } catch {
        if (!cancelled) {
          setSkillSuggestions([])
        }
      }
    }

    void loadSkillSuggestions()

    return () => {
      cancelled = true
    }
  }, [input, session])

  const suggestions = skillSuggestions.length > 0 ? skillSuggestions : commandSuggestions
  const activeSuggestion = suggestions[activeSuggestionIndex] ?? suggestions[0] ?? null
  const isOpen = suggestions.length > 0

  useEffect(() => {
    setActiveSuggestionIndex(0)
  }, [input])

  const applySuggestion = (suggestion: StudioCommandSuggestion, onApply: (nextInput: string) => void) => {
    onApply(suggestion.inputValue ?? suggestion.trigger)
    setActiveSuggestionIndex(0)
  }

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>, onApply: (nextInput: string) => void) => {
    if (isOpen && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
      event.preventDefault()
      const delta = event.key === 'ArrowDown' ? 1 : -1
      setActiveSuggestionIndex((current) => {
        const length = suggestions.length
        if (length === 0) {
          return 0
        }
        return (current + delta + length) % length
      })
      return { handled: true as const }
    }

    if (isOpen && event.key === 'Tab') {
      event.preventDefault()
      if (activeSuggestion) {
        applySuggestion(activeSuggestion, onApply)
      }
      return { handled: true as const }
    }

    if (isOpen && event.key === 'Enter') {
      event.preventDefault()
      return { handled: true as const }
    }

    if (isOpen && event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      onApply('')
      return { handled: true as const }
    }

    return { handled: false as const }
  }

  return {
    suggestions,
    activeSuggestionIndex,
    activeSuggestion,
    isOpen,
    setActiveSuggestionIndex,
    applySuggestion,
    handleKeyDown,
  }
}
