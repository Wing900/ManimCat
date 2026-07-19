export interface ProblemFramingImageFallbackOptions<T> {
  hasReferenceImages: boolean
  execute: (useImages: boolean) => Promise<T>
  shouldRetryWithoutImages: (error: unknown) => boolean
  onImageFallback?: (error: unknown) => void
}

export async function executeProblemFramingWithImageFallback<T>(
  options: ProblemFramingImageFallbackOptions<T>,
): Promise<T> {
  try {
    return await options.execute(options.hasReferenceImages)
  } catch (error) {
    if (!options.hasReferenceImages || !options.shouldRetryWithoutImages(error)) {
      throw error
    }

    options.onImageFallback?.(error)
    return options.execute(false)
  }
}
