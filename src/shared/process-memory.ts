import { spawn } from 'child_process'
import { promises as fs } from 'fs'

/**
 * 获取进程的内存使用情况（MB）
 */
export async function getProcessMemory(pid: number): Promise<number | null> {
  const platform = process.platform

  if (platform === 'linux') {
    return getLinuxProcessTreeMemory(pid)
  }

  if (platform === 'win32') {
    return getWindowsProcessMemory(pid)
  }

  return getUnixProcessMemory(pid)
}

async function getLinuxProcessTreeMemory(pid: number): Promise<number | null> {
  const visited = new Set<number>()
  const queue: number[] = [pid]
  let totalKb = 0

  while (queue.length > 0) {
    const current = queue.shift()
    if (!current || visited.has(current)) {
      continue
    }
    visited.add(current)

    const rssKb = await readLinuxVmRssKb(current)
    if (rssKb) {
      totalKb += rssKb
    }

    const children = await readLinuxChildPids(current)
    for (const child of children) {
      if (!visited.has(child)) {
        queue.push(child)
      }
    }
  }

  if (!totalKb) {
    return null
  }

  return Math.round(totalKb / 1024)
}

async function readLinuxVmRssKb(pid: number): Promise<number | null> {
  try {
    const status = await fs.readFile(`/proc/${pid}/status`, 'utf-8')
    const line = status.split(/\r?\n/).find((entry) => entry.startsWith('VmRSS:'))
    if (!line) {
      return null
    }
    const match = line.match(/VmRSS:\s+(\d+)/)
    if (!match) {
      return null
    }
    return parseInt(match[1], 10)
  } catch {
    return null
  }
}

async function readLinuxChildPids(pid: number): Promise<number[]> {
  try {
    const children = await fs.readFile(`/proc/${pid}/task/${pid}/children`, 'utf-8')
    if (!children.trim()) {
      return []
    }
    return children
      .trim()
      .split(/\s+/)
      .map((value) => parseInt(value, 10))
      .filter((value) => !Number.isNaN(value))
  } catch {
    return []
  }
}

interface WindowsProcessInfo {
  ProcessId: number
  ParentProcessId: number
  WorkingSetSize: number
}

async function getWindowsProcessMemory(pid: number): Promise<number | null> {
  const processList = await getWindowsProcessList()
  if (processList.length === 0) {
    return null
  }

  const byPid = new Map<number, WindowsProcessInfo>()
  const childrenByParent = new Map<number, number[]>()

  for (const processInfo of processList) {
    byPid.set(processInfo.ProcessId, processInfo)
    const children = childrenByParent.get(processInfo.ParentProcessId) || []
    children.push(processInfo.ProcessId)
    childrenByParent.set(processInfo.ParentProcessId, children)
  }

  const queue: number[] = [pid]
  const visited = new Set<number>()
  let totalBytes = 0

  while (queue.length > 0) {
    const current = queue.shift()
    if (!current || visited.has(current)) {
      continue
    }
    visited.add(current)

    const processInfo = byPid.get(current)
    if (processInfo && Number.isFinite(processInfo.WorkingSetSize)) {
      totalBytes += processInfo.WorkingSetSize
    }

    const children = childrenByParent.get(current)
    if (!children) {
      continue
    }

    for (const childPid of children) {
      if (!visited.has(childPid)) {
        queue.push(childPid)
      }
    }
  }

  if (totalBytes <= 0) {
    return null
  }

  return Math.round(totalBytes / 1024 / 1024)
}

async function getWindowsProcessList(): Promise<WindowsProcessInfo[]> {
  return new Promise((resolve) => {
    const command = spawn('powershell', [
      '-NoProfile',
      '-Command',
      'Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,WorkingSetSize | ConvertTo-Json -Compress'
    ])

    let stdout = ''

    command.stdout.on('data', (data) => {
      stdout += data.toString()
    })

    command.on('error', () => resolve([]))
    command.on('close', (code) => {
      if (code !== 0 || !stdout.trim()) {
        resolve([])
        return
      }

      try {
        const parsed = JSON.parse(stdout) as WindowsProcessInfo | WindowsProcessInfo[]
        const list = Array.isArray(parsed) ? parsed : [parsed]
        const normalized = list
          .map((item) => ({
            ProcessId: Number(item.ProcessId),
            ParentProcessId: Number(item.ParentProcessId),
            WorkingSetSize: Number(item.WorkingSetSize)
          }))
          .filter((item) => !Number.isNaN(item.ProcessId) && item.ProcessId > 0)

        resolve(normalized)
      } catch {
        resolve([])
      }
    })
  })
}

async function getUnixProcessMemory(pid: number): Promise<number | null> {
  return new Promise((resolve) => {
    const command = spawn('ps', ['-o', 'rss=', '-p', pid.toString()])
    let stdout = ''

    command.stdout.on('data', (data) => {
      stdout += data.toString()
    })

    command.on('error', () => resolve(null))
    command.on('close', () => {
      const output = stdout.trim()
      if (!output) {
        resolve(null)
        return
      }

      const kb = parseInt(output, 10)
      if (Number.isNaN(kb)) {
        resolve(null)
        return
      }

      resolve(Math.round(kb / 1024))
    })
  })
}
