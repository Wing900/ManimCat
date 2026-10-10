/**
 * Logger factory and singleton.
 */

import { ConsoleLogger, type Logger } from './console-logger'

export type { Logger }

export const logger: Logger = new ConsoleLogger()

export function createLogger(context: string): Logger {
  return new ConsoleLogger(context)
}
