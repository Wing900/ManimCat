import type { OutputMode } from '../../types'
import type { StudioKind } from '../domain/types'

export type StudioCodeLanguage = 'manim-python' | 'python'

/**
 * A Scene is rendered when the Builder calls the `render` Tool. Every Mode behaves the same way.
 */
export interface StudioModeDefinition {
  kind: StudioKind
  label: string
  codeLanguage: StudioCodeLanguage
  outputModes: readonly OutputMode[]
  runtimeSummary: string
}

const STUDIO_MODES: Record<StudioKind, StudioModeDefinition> = {
  manim: {
    kind: 'manim',
    label: 'Manim Studio',
    codeLanguage: 'manim-python',
    outputModes: ['video', 'image'],
    runtimeSummary: 'ManimGX 0.1.1. Use from manimgx import *; MathTypst/Typst/Text for typesetting, select() for named groups. Render Scene subclasses; pass sceneName when multiple.'
  },
  matplotlib: {
    kind: 'matplotlib',
    label: 'Matplotlib Studio',
    codeLanguage: 'python',
    outputModes: ['image'],
    runtimeSummary: 'Generate, inspect, render, and repair matplotlib Python.'
  }
}

export function getStudioModeDefinition(studioKind: StudioKind = 'manim'): StudioModeDefinition {
  return STUDIO_MODES[studioKind]
}
