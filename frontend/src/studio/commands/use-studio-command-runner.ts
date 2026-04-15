import { useCallback } from 'react'
import type { StudioCommandContext } from './types'
import { resolveStudioCommand } from './resolve-studio-command'

interface UseStudioCommandRunnerInput extends StudioCommandContext {
  onRun: (inputText: string) => Promise<void>
}

export function useStudioCommandRunner(input: UseStudioCommandRunnerInput) {
  return useCallback(async (inputText: string) => {
    const resolved = resolveStudioCommand(inputText)
    if (!resolved || resolved.definition.scope !== 'global') {
      await input.onRun(inputText)
      return { kind: 'run' as const }
    }

    await resolved.definition.execute(resolved.command as never, {
      ...input,
      runCommandInput: input.onRun,
    })
    return { kind: 'control' as const, command: resolved.command }
  }, [input])
}
