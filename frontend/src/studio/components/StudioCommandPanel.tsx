import { forwardRef, useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import { useI18n } from '../../i18n'
import type { StudioMessage, StudioSession } from '../protocol/studio-agent-types'
import { StudioCommandComposer } from './command-panel/StudioCommandComposer'
import { StudioCommandPanelHeader } from './command-panel/StudioCommandPanelHeader'
import { StudioCommandViewport } from './command-panel/StudioCommandViewport'
import {
  createStudioCommandPanelStore,
  type StudioCommandPanelSnapshot,
} from './command-panel/store'
import { useStudioCommandPanelAnimation } from './command-panel/use-studio-command-panel-animation'
import { useStudioCommandPanelShortcuts } from './command-panel/use-studio-command-panel-shortcuts'
import { useStudioCommandComposerController } from './command-panel/use-studio-command-composer-controller'

interface StudioCommandPanelProps {
  session: StudioSession | null
  messages: StudioMessage[]
  latestAssistantText: string
  isBusy: boolean
  disabled: boolean
  onRun: (inputText: string) => Promise<void> | void
  onExit: () => void
  variant?: 'default' | 't-layout-bottom' | 'pure-minimal-bottom'
  inputPlaceholderOverride?: string
  onEscapePress?: () => void
}

export interface StudioCommandPanelHandle {
  ingestImageFiles: (files: FileList | File[]) => Promise<void>
  appendPreviewAttachment: (attachment: { url: string; name: string; mimeType?: string }) => void
  focusComposer: () => void
}

export const StudioCommandPanel = forwardRef<StudioCommandPanelHandle, StudioCommandPanelProps>(function StudioCommandPanel({
  session,
  messages,
  latestAssistantText,
  isBusy,
  disabled,
  onRun,
  onExit,
  variant = 'default',
  inputPlaceholderOverride,
  onEscapePress,
}, ref) {
  const { t } = useI18n()
  const isTLayout = variant === 't-layout-bottom'
  const isMinimal = variant === 'pure-minimal-bottom'
  const isFrameless = isTLayout || isMinimal
  const scrollRef = useRef<HTMLDivElement>(null)
  const endRef = useRef<HTMLDivElement>(null)
  const lastScrollSignatureRef = useRef('')
  const animatedAssistantText = useStudioCommandPanelAnimation(latestAssistantText)

  const snapshot = useMemo<StudioCommandPanelSnapshot>(() => ({
    messages,
    isBusy,
    latestAssistantText,
    animatedAssistantText,
  }), [animatedAssistantText, isBusy, latestAssistantText, messages])
  const storeRef = useRef(createStudioCommandPanelStore(snapshot))
  const commandStore = storeRef.current
  const composer = useStudioCommandComposerController({
    disabled,
    onRun,
    composerRef: ref,
  })

  const lastMessage = messages.at(-1) ?? null

  useLayoutEffect(() => {
    commandStore.setSnapshot(snapshot)
  }, [commandStore, snapshot])

  useEffect(() => {
    const signature = [
      messages.length,
      lastMessage?.id ?? '',
      isBusy ? 'busy' : 'idle',
    ].join(':')

    if (signature === lastScrollSignatureRef.current) {
      return
    }

    lastScrollSignatureRef.current = signature
    if (typeof endRef.current?.scrollIntoView === 'function') {
      endRef.current.scrollIntoView({ block: 'end', behavior: 'smooth' })
    }
  }, [isBusy, lastMessage?.id, messages.length])

  useEffect(() => {
    composer.focusInput()
  }, [composer, disabled, session?.id])

  useStudioCommandPanelShortcuts({
    composer,
    disabled,
    onEscapePress,
  })

  const effectivePlaceholder = inputPlaceholderOverride ?? (disabled ? t('studio.initializing') : t('studio.commandPlaceholder'))
  const enterToSendLabel = t('studio.enterToSend')

  return (
    <section
      data-variant={variant}
      className={`studio-terminal relative flex h-full min-h-0 min-w-0 flex-1 flex-col ${isTLayout ? 'bg-white' : ''} ${isMinimal ? 'text-[13px] leading-loose text-text-primary' : ''}`}
    >
      {isMinimal && (
        <div className="mb-4 ml-4 mr-3 h-[1px] bg-accent opacity-[0.08]" />
      )}

      {!isFrameless && (
        <StudioCommandPanelHeader session={session} onExit={onExit} />
      )}

      <StudioCommandViewport
        store={commandStore}
        endRef={endRef}
        scrollRef={scrollRef}
        messagesLength={messages.length}
        isMinimal={isMinimal}
        isTLayout={isTLayout}
        variant={variant}
        readyLabel={t('studio.readyForCommands')}
      />

      <StudioCommandComposer
        isFrameless={isFrameless}
        isTLayout={isTLayout}
        isMinimal={isMinimal}
        isBusy={isBusy}
        disabled={disabled}
        effectivePlaceholder={effectivePlaceholder}
        enterToSendLabel={enterToSendLabel}
        onEscapePress={onEscapePress}
        composer={composer}
      />
    </section>
  )
})
