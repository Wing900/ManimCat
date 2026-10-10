/**
 * Error serializer for structured logging.
 */

export function serializeError(error: unknown): Record<string, unknown> {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: error.stack,
    }
  }
  if (typeof error === 'string') {
    return { message: error }
  }
  return { value: String(error) }
}
