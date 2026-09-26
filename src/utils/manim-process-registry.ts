/**
 * Manim Process Registry
 * Manim 子进程管理
 */

import { spawn, type ChildProcess } from 'child_process'

const activeProcesses = new Map<string, { proc: ChildProcess; cancelled: boolean }>()

function killProcessTree(proc: ChildProcess): boolean {
  try {
    if (process.platform === 'win32' && proc.pid) {
      const killer = spawn('taskkill', ['/PID', String(proc.pid), '/T', '/F'], {
        windowsHide: true,
        stdio: 'ignore',
      })
      killer.unref()
      return true
    }
    return proc.kill('SIGKILL')
  } catch {
    return false
  }
}

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

  return killProcessTree(entry.proc)
}

export function terminateManimProcess(jobId: string): boolean {
  const entry = activeProcesses.get(jobId)
  if (!entry) {
    return false
  }

  return killProcessTree(entry.proc)
}

export function wasManimProcessCancelled(jobId: string): boolean {
  return activeProcesses.get(jobId)?.cancelled ?? false
}
