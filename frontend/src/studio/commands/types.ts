import type { StudioPermissionMode, StudioSession } from '../protocol/studio-agent-types'

export type StudioCommandGroup = 'basic' | 'feature' | 'advanced'
export type StudioCommandScope = 'global' | 'local'

export interface StudioCommandPresentation {
  trigger: string
  titleKey: string
  descriptionKey: string
  aliases?: string[]
  keywords?: string[]
}

export interface StudioCommandContext {
  session: StudioSession | null
  openHistory: () => void
  createSession: () => Promise<void>
  setPendingMode: (mode: StudioPermissionMode) => void
  openImageInputMode?: () => void
  runCommandInput: (inputText: string) => Promise<void>
}

export interface StudioParsedCommandBase {
  id: string
  group: StudioCommandGroup
  raw: string
}

export interface StudioPermissionModeCommand extends StudioParsedCommandBase {
  id: 'permission-mode'
  group: 'advanced'
  mode: StudioPermissionMode
}

export interface StudioHistoryCommand extends StudioParsedCommandBase {
  id: 'history'
  group: 'basic'
}

export interface StudioNewSessionCommand extends StudioParsedCommandBase {
  id: 'new-session'
  group: 'basic'
}

export interface StudioImageInputCommand extends StudioParsedCommandBase {
  id: 'image-input'
  group: 'feature'
}

export interface StudioSkillCommand extends StudioParsedCommandBase {
  id: 'skill'
  group: 'feature'
}

export type StudioParsedCommand =
  | StudioPermissionModeCommand
  | StudioHistoryCommand
  | StudioNewSessionCommand
  | StudioImageInputCommand
  | StudioSkillCommand

export interface StudioCommandDefinition<TCommand extends StudioParsedCommand = StudioParsedCommand> {
  id: TCommand['id']
  group: StudioCommandGroup
  scope: StudioCommandScope
  presentation: StudioCommandPresentation
  matches: (input: string) => TCommand | null
  execute: (command: TCommand, context: StudioCommandContext) => Promise<void> | void
}
