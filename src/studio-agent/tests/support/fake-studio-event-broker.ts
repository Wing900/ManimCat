import type { StudioEventBrokerPort } from '../../events/studio-event-broker'

/**
 * In-memory `StudioEventBrokerPort` double: no Redis, no timers, fully deterministic.
 * Tests drive remote delivery explicitly via `deliver()`.
 */
export class FakeStudioEventBroker implements StudioEventBrokerPort {
  readonly published: string[] = []
  startCount = 0
  closeCount = 0
  startError: Error | null = null
  publishError: Error | null = null

  private readonly startGate: Promise<void> | null
  private onMessage: ((serializedEnvelope: string) => void) | null = null

  constructor(options?: { startGate?: Promise<void> }) {
    this.startGate = options?.startGate ?? null
  }

  async start(onMessage: (serializedEnvelope: string) => void): Promise<void> {
    this.startCount += 1
    this.onMessage = onMessage
    if (this.startGate) {
      await this.startGate
    }
    if (this.startError) {
      throw this.startError
    }
  }

  async publish(serializedEnvelope: string): Promise<void> {
    if (this.publishError) {
      throw this.publishError
    }
    this.published.push(serializedEnvelope)
  }

  async close(): Promise<void> {
    this.closeCount += 1
  }

  /** Simulates one envelope arriving over Pub/Sub from another replica. */
  deliver(serializedEnvelope: string): void {
    if (!this.onMessage) {
      throw new Error('FakeStudioEventBroker: start() was not called')
    }
    this.onMessage(serializedEnvelope)
  }

  get isStarted(): boolean {
    return this.onMessage !== null
  }
}

export interface RecordedLogEntry {
  level: 'info' | 'warn' | 'error'
  message: string
  meta?: unknown
}

/** Recording logger double for bus/broker diagnostics. */
export class RecordingStudioEventLogger {
  readonly entries: RecordedLogEntry[] = []

  info(message: string, meta?: unknown): void {
    this.entries.push({ level: 'info', message, meta })
  }

  warn(message: string, meta?: unknown): void {
    this.entries.push({ level: 'warn', message, meta })
  }

  error(message: string, meta?: unknown): void {
    this.entries.push({ level: 'error', message, meta })
  }

  messages(level?: RecordedLogEntry['level']): string[] {
    return this.entries
      .filter((entry) => level === undefined || entry.level === level)
      .map((entry) => entry.message)
  }
}
