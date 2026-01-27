/**
 * Manim Process Registry
 * Manim 子进程管理
 */

import type { ChildProcess } from 'child_process'

const activeProcesses = new Map<string, { proc: ChildProcess; cancelled: boolean }>()

export function registerManimProcess(jobId: string, proc: ChildProcess): void {
  activeProcesses.set(jobId, { proc, cancelled: false })
}

export function unregisterManimProcess(jobId: string): void {
  activeProcesses.delete(jobId)
}

export function cancelManimProcess(jobId: string): boolean {
  const entry = activeProcesses.get(jobId)
  if (!entry) {
    return false
  }

  entry.cancelled = true

  try {
    entry.proc.kill('SIGKILL')
  } catch {
    return false
  }

  return true
}

export function wasManimProcessCancelled(jobId: string): boolean {
  return activeProcesses.get(jobId)?.cancelled ?? false
}
