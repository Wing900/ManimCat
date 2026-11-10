/**
 * The single render-boundary decision for a workflow job.
 *
 * Cloud jobs keep the byte-for-byte existing video/image path. Browser jobs stop here:
 * the worker prepares the portable source/narration payload and never invokes the
 * native Manim/FFmpeg path. Keeping this decision in one place prevents render-target
 * checks from spreading through the individual steps.
 */

import type { GenerationResult } from './analysis-step'
import type { OutputMode, PromptOverrides, RenderTarget, VideoConfig } from '../../../../types'
import type { RenderResult } from './render-step-types'
import { renderImages } from './render-images'
import { renderVideo } from './render-video'
import { prepareBrowserRenderResult } from '../../../browser/browser-render-payload'

export interface RenderOutputArgs {
  jobId: string
  concept: string
  quality: string
  outputMode: OutputMode
  renderTarget?: RenderTarget
  codeResult: GenerationResult
  timings: Record<string, number>
  customApiConfig?: unknown
  videoConfig?: VideoConfig
  promptOverrides?: PromptOverrides
  onStageUpdate?: () => Promise<void>
  clientId?: string
  workspaceDirectory?: string
  renderCacheKey?: string
  workspaceOutputDirectory?: string
  sceneName?: string
}

export async function renderOutput(args: RenderOutputArgs): Promise<RenderResult> {
  const renderTarget = args.renderTarget ?? 'cloud'

  if (renderTarget === 'browser') {
    return prepareBrowserRenderResult({
      jobId: args.jobId,
      concept: args.concept,
      quality: args.quality,
      outputMode: args.outputMode,
      renderTarget,
      codeResult: args.codeResult,
      sceneName: args.sceneName,
      videoConfig: args.videoConfig,
      renderCacheKey: args.renderCacheKey,
    })
  }

  return args.outputMode === 'image'
    ? renderImages(
        args.jobId,
        args.concept,
        args.quality,
        args.codeResult,
        args.timings,
        args.videoConfig,
        args.customApiConfig,
        args.promptOverrides,
        args.onStageUpdate,
        args.clientId,
        args.workspaceDirectory,
        args.renderCacheKey,
        args.workspaceOutputDirectory
      )
    : renderVideo(
        args.jobId,
        args.concept,
        args.quality,
        args.codeResult,
        args.timings,
        args.customApiConfig,
        args.videoConfig,
        args.promptOverrides,
        args.onStageUpdate,
        args.clientId,
        args.workspaceDirectory,
        args.renderCacheKey,
        args.workspaceOutputDirectory,
        args.sceneName
      )
}
