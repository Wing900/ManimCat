import type { OutputMode } from '../../types'
import type { StudioKind } from '../domain/types'

export type StudioDocumentationKey = 'manim' | 'matplotlib'
export type StudioCodeLanguage = 'manim-python' | 'python'
export interface StudioModeDefinition {
  kind: StudioKind
  label: string
  documentationKey: StudioDocumentationKey
  codeLanguage: StudioCodeLanguage
  outputModes: readonly OutputMode[]
  runtimeSummary: string
  autoRenderAfterTools: readonly string[]
}

const STUDIO_MODES: Record<StudioKind, StudioModeDefinition> = {
  manim: {
    kind: 'manim',
    label: 'Manim Studio',
    documentationKey: 'manim',
    codeLanguage: 'manim-python',
    outputModes: ['video', 'image'],
    runtimeSummary: 'Generate, inspect, render, and repair Manim Python.',
    autoRenderAfterTools: []
  },
  plot: {
    kind: 'plot',
    label: 'Matplotlib Studio',
    documentationKey: 'matplotlib',
    codeLanguage: 'python',
    outputModes: ['image'],
    runtimeSummary: 'Generate, inspect, render, and repair matplotlib Python.',
    autoRenderAfterTools: ['write', 'edit', 'apply_patch']
  }
}

export function getStudioModeDefinition(studioKind: StudioKind = 'manim'): StudioModeDefinition {
  return STUDIO_MODES[studioKind]
}
