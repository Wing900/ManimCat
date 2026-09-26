import { createLogger } from '../../utils/logger'
import type { StudioEventBus } from '../domain/types'
import type { StudioRunStore } from '../domain/store-types'
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
  StudioRunCoordinationService,
  type StudioRunRenewalScheduler
} from './studio-run-coordination-service'

/** Production Run coordination: the service plus its explicit lifecycle. */
export interface StudioRunCoordinationRuntime {
  service: StudioRunCoordinationService
  transport: StudioRunCoordinationTransport
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

  return {
    service,
    transport,
    start: () => service.start(),
    close: () => service.close()
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
