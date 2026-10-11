import { createLogger } from '../../../shared/logging/logger'
import type { StudioEventBus, StudioRun } from '../../domain/types'
import type { StudioRunStore } from '../../domain/store-types'
import {
  resolveStudioRunCancellationTtlMs,
  resolveStudioRunControlChannel,
  resolveStudioRunCoordinationTransport,
  resolveStudioRunLeaseRenewMs,
  resolveStudioRunLeaseTtlMs,
  resolveStudioRunRedisPrefix,
  type StudioRunCoordinationLogger,
  type StudioRunCoordinationTransport,
  type StudioRunCoordinatorPort
} from './studio-run-coordinator'
import { createInMemoryStudioRunCoordinator } from './in-memory-studio-run-coordinator'
import {
  STUDIO_RUN_LIVENESS_SWEEP_INTERVAL_MS,
  createStudioRunLivenessSweeper,
  type StudioRunLivenessSweeper
} from './studio-run-liveness-sweeper'
import {
  StudioRunCoordinationService,
  type StudioRunRenewalScheduler
} from './studio-run-coordination-service'

/** Production Run coordination: the service plus its explicit lifecycle. */
export interface StudioRunCoordinationRuntime {
  service: StudioRunCoordinationService
  transport: StudioRunCoordinationTransport
  /** Absent when the transport cannot prove a scope has no owner (see the factory below). */
  runLiveness?: StudioRunLivenessSweeper
  start(): Promise<void>
  close(): Promise<void>
}

export interface CreateDefaultStudioRunCoordinationOptions {
  env?: NodeJS.ProcessEnv
  runStore?: StudioRunStore
  eventBus?: StudioEventBus
  logger?: StudioRunCoordinationLogger
  scheduler?: StudioRunRenewalScheduler
  /**
   * Redis coordinator factory. Production injects the adapter; keeping it injected means
   * this module (and therefore every test importing it) never pulls in the shared Redis client.
   */
  createCoordinator?: (input: {
    prefix: string
    controlChannel: string
    leaseTtlMs: number
    cancellationTtlMs: number
  }) => StudioRunCoordinatorPort
}

export function createDefaultStudioRunCoordination(
  options: CreateDefaultStudioRunCoordinationOptions = {}
): StudioRunCoordinationRuntime {
  const env = options.env ?? process.env
  const logger = options.logger ?? createLogger('StudioRunCoordination')
  const transport = resolveStudioRunCoordinationTransport(env)

  // Configuration is validated in both modes: an unsafe TTL must fail fast rather than
  // silently fall back to a longer-lived lease.
  const leaseTtlMs = resolveStudioRunLeaseTtlMs(env)
  const leaseRenewMs = resolveStudioRunLeaseRenewMs(env, leaseTtlMs)
  const cancellationTtlMs = resolveStudioRunCancellationTtlMs(env)

  const coordinator = transport === 'memory'
    ? createInMemoryStudioRunCoordinator({ leaseTtlMs, cancellationTtlMs, logger })
    : createRedisCoordinator()

  const service = new StudioRunCoordinationService({
    coordinator,
    runStore: options.runStore,
    eventBus: options.eventBus,
    logger,
    scheduler: options.scheduler,
    leaseRenewMs
  })

  // A sweep only means something where the lease lives where other processes can see it. With the
  // in-memory transport, "this scope is free" proves nothing about a replica this process cannot
  // observe, so the sweep stays off instead of guessing: an empty local map would kill live Runs.
  const activeRunFeed = readActiveRunFeed(options.runStore)
  const runLiveness =
    transport === 'redis' && activeRunFeed
      ? createStudioRunLivenessSweeper({
          logger,
          port: {
            listActiveRuns: activeRunFeed,
            readScopeLiveness: (scope) => service.readScopeLiveness(scope),
            reconcileScopeRuns: (input) => service.reconcileStaleRuns(input)
          }
        })
      : undefined
  logger.info(
    runLiveness
      ? `Studio Run liveness sweep every ${STUDIO_RUN_LIVENESS_SWEEP_INTERVAL_MS / 1000}s: a Run whose owner died is finalized once its lease expires`
      : 'Studio Run liveness sweep is off: it needs the Redis transport and a store that can list active Runs'
  )

  return {
    service,
    transport,
    runLiveness,
    start: async () => {
      await service.start()
      runLiveness?.start()
    },
    close: async () => {
      // Stop sweeping first: while this process still holds leases it must not also be judging them.
      runLiveness?.stop()
      await service.close()
    }
  }

  /**
   * The active-Run feed is a capability, not a core read: a store either offers it or the sweep stays
   * off. Binding here keeps the call site free of the optional-chaining dance and of non-null claims.
   */
  function readActiveRunFeed(store: StudioRunStore | undefined): ((limit: number) => Promise<StudioRun[]>) | null {
    const feed = store?.listActiveRuns
    if (!store || !feed) {
      return null
    }
    return (limit) => feed.call(store, limit)
  }

  function createRedisCoordinator(): StudioRunCoordinatorPort {
    if (!options.createCoordinator) {
      throw new Error('Studio Redis Run coordination requires a coordinator factory')
    }
    return options.createCoordinator({
      prefix: resolveStudioRunRedisPrefix(env),
      controlChannel: resolveStudioRunControlChannel(env),
      leaseTtlMs,
      cancellationTtlMs
    })
  }
}
