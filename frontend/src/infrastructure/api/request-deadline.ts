/**
 * A focused deadline for one fetch plus its bounded body read. It composes the caller's
 * AbortSignal instead of replacing it, and never touches any app-wide request lifetime.
 */

export class RequestDeadlineError extends Error {
  constructor() {
    super('Request deadline exceeded');
    this.name = 'RequestDeadlineError';
  }
}

export class ResponseTooLargeError extends Error {
  constructor() {
    super('Response body exceeds the allowed size');
    this.name = 'ResponseTooLargeError';
  }
}

export interface RequestDeadline {
  signal: AbortSignal;
  timedOut: () => boolean;
  dispose: () => void;
}

export function createRequestDeadline(
  parentSignal: AbortSignal | undefined,
  timeoutMs: number,
): RequestDeadline {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new Error('Request deadline must be a positive number');
  }
  const controller = new AbortController();
  let timedOut = false;
  const onParentAbort = () => controller.abort(parentSignal?.reason);

  if (parentSignal) {
    if (parentSignal.aborted) {
      onParentAbort();
    } else {
      parentSignal.addEventListener('abort', onParentAbort, { once: true });
    }
  }
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort(new RequestDeadlineError());
  }, timeoutMs);

  return {
    signal: controller.signal,
    timedOut: () => timedOut,
    dispose: () => {
      clearTimeout(timer);
      parentSignal?.removeEventListener('abort', onParentAbort);
    },
  };
}

/** Reads the whole body with a hard byte ceiling and releases the reader on every path. */
export async function readResponseBytesBounded(
  response: Response,
  maxBytes: number,
): Promise<ArrayBuffer> {
  if (!Number.isFinite(maxBytes) || maxBytes <= 0) {
    throw new Error('Response size limit must be a positive number');
  }
  if (!response.body) {
    return new ArrayBuffer(0);
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value || value.byteLength === 0) continue;
      total += value.byteLength;
      if (total > maxBytes) {
        throw new ResponseTooLargeError();
      }
      chunks.push(value);
    }
  } catch (error) {
    try {
      await reader.cancel();
    } catch {
      // The stream may already be errored or released; the body is no longer used.
    }
    throw error;
  } finally {
    try {
      reader.releaseLock();
    } catch {
      // Releasing an already-released reader is harmless.
    }
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes.buffer;
}
