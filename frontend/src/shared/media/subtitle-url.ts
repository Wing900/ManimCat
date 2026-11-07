/**
 * The narration renderer writes `<jobId>.vtt` beside `<jobId>.mp4`. Deriving the
 * caption URL from the video URL keeps the job DTO unchanged; a film without
 * narration simply has no sidecar.
 */
export function deriveSubtitleUrl(videoUrl: string | null | undefined): string | null {
  if (!videoUrl) return null
  const trimmed = videoUrl.trim()
  if (!trimmed || trimmed.startsWith('blob:') || trimmed.startsWith('data:')) {
    return null
  }
  const match = trimmed.match(/^(.*)\.mp4((?:\?[^#]*)?)$/i)
  if (!match) return null
  return `${match[1]}.vtt${match[2]}`
}
