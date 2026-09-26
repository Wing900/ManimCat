import type { StudioAgentEvent, StudioEventBus } from '../domain/types'
import { InMemoryStudioEventBus, type StudioEventListener } from './event-bus'
import type { StudioEventBrokerLogger, StudioEventBrokerPort } from './studio-event-broker'
import {
  createStudioEventEnvelope,
  createStudioEventOriginId,
  decodeStudioEventEnvelope,
  encodeStudioEventEnvelope
} from './studio-event-envelope'

export interface DistributedStudioEventBusOptions {
  broker: StudioEventBrokerPort
  /** Overridable for deterministic tests; defaults to a unique per-process id. */
  originId?: string
  logger?: StudioEventBrokerLogger
  /** Local fan-out implementation; the final routing boundary stays session-scoped. */
  localBus?: StudioEventBus
}

const NOOP_LOGGER: StudioEventBrokerLogger = {
  info() {},
  warn() {},
  error() {}
}

/**
 * Fan-out Studio event bus for multi-instance deployments.
 *
 * - `publish` stays synchronous for local listeners (the domain contract), then hands the
 *   event to the broker asynchronously; a transport outage never breaks the local run.
 * - Remote envelopes are decoded defensively, own-origin echoes are dropped, and a foreign
 *   event is delivered exactly once through the local bus. Remote events are never
 *   republished, so a publish loop cannot form.
 */
export class DistributedStudioEventBus implements StudioEventBus {
  private readonly localBus: StudioEventBus
  private readonly broker: StudioEventBrokerPort
  private readonly originId: string
  private readonly logger: StudioEventBrokerLogger
  private startPromise: Promise<void> | null = null
  private closePromise: Promise<void> | null = null
  private pendingBrokerPublish: Promise<void> = Promise.resolve()

  constructor(options: DistributedStudioEventBusOptions) {
    this.localBus = options.localBus ?? new InMemoryStudioEventBus()
    this.broker = options.broker
    this.originId = options.originId ?? createStudioEventOriginId()
    this.logger = options.logger ?? NOOP_LOGGER
  }

  getOriginId(): string {
    return this.originId
  }

  /** Local delivery first, broker fan-out second; failures are contained and logged. */
  publish(event: StudioAgentEvent): void {
    this.localBus.publish(event)

    let serialized: string
    try {
      serialized = encodeStudioEventEnvelope(
        createStudioEventEnvelope({ event, originId: this.originId })
      )
    } catch (error) {
      this.log('error', 'Studio event envelope could not be encoded', messageOf(error))
      return
    }

    // Chained so publishes keep their order and `whenIdle()` is a deterministic drain hook.
    this.pendingBrokerPublish = this.pendingBrokerPublish.then(() => this.publishToBroker(serialized))
  }

  subscribe(sessionId: string, listener: StudioEventListener): () => void {
    return this.localBus.subscribe(sessionId, listener)
  }

  /** Subscribes to the broker exactly once; concurrent calls share one initialization. */
  start(): Promise<void> {
    this.startPromise ??= this.startBroker()
    return this.startPromise
  }

  /** Idempotent teardown of owned resources (never the shared publisher). */
  close(): Promise<void> {
    this.closePromise ??= this.closeBroker()
    return this.closePromise
  }

  /** Resolves once every queued broker publish has settled; used by tests instead of sleeps. */
  whenIdle(): Promise<void> {
    return this.pendingBrokerPublish
  }

  private async startBroker(): Promise<void> {
    try {
      await this.broker.start((serialized) => {
        this.handleRemoteEnvelope(serialized)
      })
    } catch (error) {
      this.log('error', 'Studio event broker subscription failed', messageOf(error))
      throw error
    }
  }

  private async closeBroker(): Promise<void> {
    try {
      await this.broker.close()
    } catch (error) {
      this.log('error', 'Studio event broker close failed', messageOf(error))
    }
  }

  private async publishToBroker(serialized: string): Promise<void> {
    try {
      await this.broker.publish(serialized)
    } catch (error) {
      this.log('error', 'Studio event broker publish failed', messageOf(error))
    }
  }

  private handleRemoteEnvelope(serialized: string): void {
    const decoded = decodeStudioEventEnvelope(serialized)
    if (!decoded.ok) {
      this.log('warn', 'Ignoring invalid Studio event envelope', decoded.reason)
      return
    }
    if (decoded.envelope.originId === this.originId) {
      // Own-origin echo: the event was already delivered to local listeners.
      return
    }

    try {
      // Delivery only — never republished, so remote events cannot loop back to the broker.
      this.localBus.publish(decoded.envelope.event)
    } catch (error) {
      // A throwing listener must not escape into the transport's message handler.
      this.log('error', 'Studio event listener failed for a remote event', messageOf(error))
    }
  }

  private log(level: 'info' | 'warn' | 'error', message: string, meta?: unknown): void {
    try {
      this.logger[level](message, meta)
    } catch {
      // Logging must never break event delivery.
    }
  }
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
