const RESOLUTIONS: Record<string, { width: number; height: number }> = {
  low: { width: 854, height: 480 },
  medium: { width: 1280, height: 720 },
  high: { width: 1920, height: 1080 },
}

export interface ManimGxInvocationOptions {
  /** Interpreter resolved once by the caller so runtime selection is not repeated. */
  python: string
  codeFile: string
  outputPath: string
  quality: string
  frameRate: number
  format: 'mp4' | 'png'
  sceneName?: string
  narrationManifestPath?: string
  narrationSyncReportPath?: string
}

export interface ManimGxInvocation {
  python: string
  args: string[]
}

/** Build the runner argv. Paths are already expressed in the sandbox namespace. */
export function buildManimGxInvocation(options: ManimGxInvocationOptions): ManimGxInvocation {
  const resolution = RESOLUTIONS[options.quality] ?? RESOLUTIONS.medium

  return {
    python: options.python,
    args: [
      '-u',
      '/runner/manimgx-runner.py',
      options.codeFile,
      ...(options.sceneName ? ['--scene', options.sceneName] : []),
      '--output', options.outputPath,
      '--format', options.format,
      '--width', String(resolution.width),
      '--height', String(resolution.height),
      '--fps', String(options.frameRate),
      ...(options.narrationManifestPath ? [`--narration=${options.narrationManifestPath}`] : []),
      ...(options.narrationSyncReportPath ? [`--sync-report=${options.narrationSyncReportPath}`] : []),
    ],
  }
}
