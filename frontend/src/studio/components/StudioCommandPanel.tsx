import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { CanvasWorkspaceModal } from '../../components/canvas/CanvasWorkspaceModal'
import { ImageInputModeModal } from '../../components/ImageInputModeModal'
import { ReferenceImageList } from '../../components/input-form/reference-image-list'
import { useReferenceImages } from '../../components/input-form/use-reference-images'
import type { StudioMessage, StudioSession } from '../protocol/studio-agent-types'
import { useI18n } from '../../i18n'
import type { ReferenceImage } from '../../types/api'
import { appendStudioReferenceImages } from '../reference-images'
import { StudioCommandMessageList } from './command-panel/StudioCommandMessageList'
import {
  createStudioCommandPanelStore,
  type StudioCommandPanelSnapshot,
} from './command-panel/store'

interface StudioCommandPanelProps {
  session: StudioSession | null
  messages: StudioMessage[]
  latestAssistantText: string
  isBusy: boolean
  disabled: boolean
  onRun: (inputText: string) => Promise<void> | void
  onExit: () => void
}

export function StudioCommandPanel({
  session,
  messages,
  latestAssistantText,
  isBusy,
  disabled,
  onRun,
  onExit,
}: StudioCommandPanelProps) {
  const { t } = useI18n()
  const [input, setInput] = useState('')
  const [isImageModeOpen, setIsImageModeOpen] = useState(false)
  const [isCanvasOpen, setIsCanvasOpen] = useState(false)
  const [animatedAssistantText, setAnimatedAssistantText] = useState('')
  const scrollRef = useRef<HTMLDivElement>(null)
  const endRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const streamRateRef = useRef(0)
  const latestTextMetaRef = useRef<{ text: string; at: number }>({ text: '', at: 0 })
  const lastScrollSignatureRef = useRef('')
  const snapshot = useMemo<StudioCommandPanelSnapshot>(() => ({
    messages,
    isBusy,
    latestAssistantText,
    animatedAssistantText,
  }), [animatedAssistantText, isBusy, latestAssistantText, messages])
  const storeRef = useRef(createStudioCommandPanelStore(snapshot))
  const commandStore = storeRef.current
  const {
    images,
    imageError,
    fileInputRef,
    addImages,
    appendImages,
    removeImage,
    clearImages,
  } = useReferenceImages({ enablePasteListener: false })

  const handleSubmit = async () => {
    const next = input.trim()
    if (!next || disabled) {
      return
    }
    if (next === '/p') {
      setInput('')
      setIsImageModeOpen(true)
      return
    }
    setInput('')
    const runInput = appendStudioReferenceImages(next, images)
    try {
      await onRun(runInput)
      clearImages()
    } catch {
      setInput(next)
    }
    inputRef.current?.focus()
  }

  const focusInput = () => {
    if (disabled) {
      return
    }
    inputRef.current?.focus()
  }

  const handleImportImages = () => {
    setIsImageModeOpen(false)
    fileInputRef.current?.click()
  }

  const handleCanvasComplete = (nextImages: ReferenceImage[]) => {
    appendImages(nextImages)
    setIsCanvasOpen(false)
    focusInput()
  }

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
    if (!disabled) {
      focusInput()
    }
  }, [disabled, session?.id])

  useEffect(() => {
    const handleWindowKeyDown = (event: KeyboardEvent) => {
      if (disabled || event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) {
        return
      }

      const target = event.target as HTMLElement | null
      if (
        target instanceof HTMLInputElement
        || target instanceof HTMLTextAreaElement
        || target?.isContentEditable
      ) {
        return
      }

      if (!shouldRedirectKeyToInput(event)) {
        return
      }

      focusInput()
      if (event.key === 'Backspace') {
        setInput((current) => current.slice(0, -1))
        event.preventDefault()
        return
      }

      if (event.key.length === 1) {
        setInput((current) => `${current}${event.key}`)
        event.preventDefault()
      }
    }

    window.addEventListener('keydown', handleWindowKeyDown)
    return () => window.removeEventListener('keydown', handleWindowKeyDown)
  }, [disabled])

  useEffect(() => {
    if (!latestAssistantText) {
      streamRateRef.current = 0
      latestTextMetaRef.current = { text: '', at: 0 }
      const frame = window.requestAnimationFrame(() => {
        setAnimatedAssistantText('')
      })
      return () => window.cancelAnimationFrame(frame)
    }

    const now = Date.now()
    const prev = latestTextMetaRef.current
    if (prev.text && latestAssistantText.startsWith(prev.text) && latestAssistantText.length > prev.text.length) {
      const deltaChars = latestAssistantText.length - prev.text.length
      const deltaMs = Math.max(1, now - prev.at)
      const charsPerSecond = (deltaChars * 1000) / deltaMs
      streamRateRef.current = streamRateRef.current === 0
        ? charsPerSecond
        : streamRateRef.current * 0.68 + charsPerSecond * 0.32
    } else if (!prev.text) {
      streamRateRef.current = 0
    }
    latestTextMetaRef.current = { text: latestAssistantText, at: now }

    const frame = window.requestAnimationFrame(() => {
      setAnimatedAssistantText((current) => {
        if (!latestAssistantText.startsWith(current)) {
          return latestAssistantText.slice(0, 1)
        }
        return current || latestAssistantText.slice(0, 1)
      })
    })

    return () => window.cancelAnimationFrame(frame)
  }, [latestAssistantText])

  useEffect(() => {
    if (!latestAssistantText) {
      return
    }

    if (animatedAssistantText === latestAssistantText) {
      return
    }

    const timer = window.setTimeout(() => {
      setAnimatedAssistantText((current) => {
        if (!latestAssistantText.startsWith(current)) {
          return latestAssistantText.slice(0, 1)
        }

        const nextLength = current.length + nextTypeStep(latestAssistantText.length - current.length)
        return latestAssistantText.slice(0, nextLength)
      })
    }, nextTypeDelay(latestAssistantText, animatedAssistantText.length, streamRateRef.current))

    return () => window.clearTimeout(timer)
  }, [animatedAssistantText, latestAssistantText])

  return (
    <section className="studio-terminal flex h-full min-h-0 min-w-0 flex-1 flex-col">
      <header className="shrink-0 flex items-center justify-between gap-4 px-8 py-5">
        <div className="flex items-center gap-3">
          <div className="h-2 w-2 rounded-full bg-accent-rgb/20 animate-pulse" />
          <div className="studio-brand-title text-[13px] font-bold uppercase tracking-[0.2em] text-text-primary/70">
            {session?.title ?? t('studio.title')}
          </div>
        </div>
        <button
          type="button"
          onClick={onExit}
          className="text-[11px] font-medium uppercase tracking-[0.28em] text-text-secondary/45 transition hover:text-rose-500/80"
        >
          {t('common.close')}
        </button>
      </header>

      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto px-8 py-10">
        {messages.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full text-center opacity-30">
            <div className="mb-4 text-3xl">🐾</div>
            <div className="font-mono text-[10px] uppercase tracking-[0.4em]">{t('studio.readyForCommands')}</div>
          </div>
        )}

        <StudioCommandMessageList store={commandStore} endRef={endRef} />
      </div>

      <footer className="shrink-0 px-8 py-6">
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          multiple
          className="hidden"
          onChange={(event) => {
            const files = event.target.files
            if (files && files.length > 0) {
              void addImages(files)
            }
            event.currentTarget.value = ''
          }}
        />
        <ReferenceImageList images={images} loading={isBusy} onRemove={removeImage} />
        {imageError ? (
          <p className="mb-3 mt-3 text-xs text-rose-500/80">{imageError}</p>
        ) : null}
        <div className="flex items-center gap-4">
          <span className="font-mono text-sm text-text-secondary/40 tracking-widest">{'>'}</span>
          <input
            ref={inputRef}
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                void handleSubmit()
              }
            }}
            placeholder={disabled ? t('studio.initializing') : t('studio.commandPlaceholder')}
            disabled={false}
            aria-disabled={disabled}
            className="flex-1 bg-transparent text-[14px] font-medium leading-relaxed text-text-primary outline-none placeholder:text-text-secondary/25"
          />
          <div className="flex items-center gap-2 opacity-30">
             <div className="font-mono text-[9px] uppercase tracking-widest text-text-secondary">{t('studio.enterToSend')}</div>
          </div>
        </div>
      </footer>

      <ImageInputModeModal
        isOpen={isImageModeOpen}
        onClose={() => setIsImageModeOpen(false)}
        onImport={handleImportImages}
        onDraw={() => {
          setIsImageModeOpen(false)
          setIsCanvasOpen(true)
        }}
      />

      <CanvasWorkspaceModal
        isOpen={isCanvasOpen}
        onClose={() => setIsCanvasOpen(false)}
        onComplete={handleCanvasComplete}
      />
    </section>
  )
}

function nextTypeDelay(target: string, currentLength: number, streamRate: number) {
  const nextChar = target[currentLength] ?? ''
  const backlog = target.length - currentLength
  const targetCharsPerSecond = resolveTypingCharsPerSecond(backlog, streamRate)
  if (!nextChar) {
    return 18
  }

  if (nextChar === '\n') {
    return 1000 / Math.max(targetCharsPerSecond * 1.4, 1)
  }

  if (/[，。！？；：,.!?;:]/.test(nextChar)) {
    return Math.max(24, 1000 / Math.max(targetCharsPerSecond * 0.55, 1))
  }

  if (/\s/.test(nextChar)) {
    return Math.max(10, 1000 / Math.max(targetCharsPerSecond * 1.25, 1))
  }

  return Math.max(12, 1000 / Math.max(targetCharsPerSecond, 1))
}

function nextTypeStep(backlog: number) {
  if (backlog >= 28) {
    return 3
  }

  if (backlog >= 16) {
    return 2
  }

  return 1
}

function resolveTypingCharsPerSecond(backlog: number, streamRate: number) {
  const minCharsPerSecond = 10
  const maxCharsPerSecond = 26
  const adaptiveBase = streamRate > 0 ? streamRate * 0.55 + 6 : minCharsPerSecond

  if (backlog >= 10) {
    return clamp(adaptiveBase, 12, maxCharsPerSecond)
  }

  return clamp(adaptiveBase, minCharsPerSecond, 18)
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
}

function shouldRedirectKeyToInput(event: KeyboardEvent): boolean {
  return event.key.length === 1 || event.key === 'Backspace'
}
