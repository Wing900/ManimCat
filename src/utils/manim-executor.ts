/**

 * Manim 执行器

 * 执行 Manim 命令，管理子进程

 */



import { spawn } from 'child_process'
import { promises as fs } from 'fs'

import { createLogger } from './logger'

import { registerManimProcess, unregisterManimProcess, wasManimProcessCancelled } from './manim-process-registry'



const logger = createLogger('ManimExecutor')



/**

 * Manim 执行结果

 */

export interface ManimExecutionResult {

  success: boolean

  stdout: string

  stderr: string

  peakMemoryMB: number

}



/**

 * Manim 执行选项

 */

export interface ManimExecuteOptions {

  jobId: string

  quality: string

  frameRate: number

  tempDir: string

  mediaDir: string

}



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



/**

 * 执行 manim 命令

 */

export function executeManimCommand(

  codeFile: string,

  options: ManimExecuteOptions

): Promise<ManimExecutionResult> {

  const { jobId, quality, frameRate, tempDir, mediaDir } = options



  return new Promise((resolve) => {

    const startTime = Date.now()



    // 质量对应的分辨率

    const resolutionMap: Record<string, { width: number; height: number }> = {

      low: { width: 854, height: 480 },

      medium: { width: 1280, height: 720 },

      high: { width: 1920, height: 1080 }

    }



    const resolution = resolutionMap[quality] || resolutionMap.medium



    const args = [

      'render',

      '--format', 'mp4',

      '-r', frameRate.toString(),

      '--resolution', `${resolution.width},${resolution.height}`,

      '--media_dir', mediaDir,

      codeFile,

      'MainScene'

    ]



    logger.info(`Job ${jobId}: 启动 manim 进程`, {

      command: `manim ${args.join(' ')}`,

      cwd: tempDir

    })



    const proc = spawn('manim', args, { cwd: tempDir })



    registerManimProcess(jobId, proc)



    let stdout = ''

    let stderr = ''

    let lastProgressTime = Date.now()

    let lastLogTime = Date.now()

    let peakMemory = 0 // 峰值内存（MB）



    // 内存监控定时器（每2秒检查一次）

    const memoryMonitor = setInterval(async () => {

      if (proc.pid) {

        const memory = await getProcessMemory(proc.pid)

        if (memory !== null) {

          if (memory > peakMemory) {

            peakMemory = memory

          }

          logger.info(`Job ${jobId}: Manim 内存使用（进程树总和）`, {

            memoryMB: memory,

        peakMemoryMB: peakMemory

          })

        }

      }

    }, 2000)



    proc.stdout.on('data', (data) => {

      const text = data.toString()

      stdout += text



    // 10 minutes timeout

      const elapsed = Date.now() - lastLogTime

      if (elapsed > 5000) {

        logger.info(`Job ${jobId}: Manim 进度输出`, {

          output: text.trim(),

          totalOutputLength: stdout.length

        })

        lastLogTime = Date.now()

      }



      // 检测进度条更新（单独处理，更频繁）

      if (text.includes('%') || text.includes('it/s')) {

        const progressElapsed = Date.now() - lastProgressTime

        if (progressElapsed > 3000) {

          logger.info(`Job ${jobId}: 渲染进度`, { progress: text.trim() })

          lastProgressTime = Date.now()

        }

      }

    })



    proc.stderr.on('data', (data) => {

      const text = data.toString()

      stderr += text



      // 实时记录所有 stderr 输出（不论是否包含错误）

      logger.info(`Job ${jobId}: Manim stderr 实时输出`, {

        output: text.trim(),

        totalStderrLength: stderr.length

      })

    })



    // 10 minutes timeout

    const timeout = setTimeout(() => {

      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1)

      logger.warn(`Job ${jobId}: Manim render timeout (${elapsed}s), killing process`, {

        peakMemoryMB: peakMemory

      })

      clearInterval(memoryMonitor)

      proc.kill('SIGKILL')

      resolve({

        success: false,

        stdout,

        stderr: stderr || 'Manim render timeout (10 minutes)',

        peakMemoryMB: peakMemory

      })

    }, 10 * 60 * 1000)



    proc.on('close', (code) => {

      clearTimeout(timeout)

      clearInterval(memoryMonitor)

      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1)

      const cancelled = wasManimProcessCancelled(jobId)

      unregisterManimProcess(jobId)



      if (cancelled) {

        logger.warn(`Job ${jobId}: Manim cancelled`, { elapsed: `${elapsed}s` })

        resolve({ success: false, stdout, stderr: 'Job cancelled', peakMemoryMB: peakMemory })

        return

      }



      if (code == 0) {

        logger.info(`Job ${jobId}: Manim 成功完成`, {

          elapsed: `${elapsed}s`,

          exitCode: code,

          stdoutLength: stdout.length,

          stderrLength: stderr.length,

        peakMemoryMB: peakMemory

        })

        resolve({ success: true, stdout, stderr, peakMemoryMB: peakMemory })

      } else {

        logger.error(`Job ${jobId}: Manim 退出异常`, {

          elapsed: `${elapsed}s`,

          exitCode: code,

          stdoutLength: stdout.length,

          stderrLength: stderr.length,

          stderrPreview: stderr.slice(-500),

        peakMemoryMB: peakMemory

        })

        resolve({ success: false, stdout, stderr, peakMemoryMB: peakMemory })

      }

    })



    proc.on('error', (error) => {

      clearTimeout(timeout)

      clearInterval(memoryMonitor)

      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1)

      const cancelled = wasManimProcessCancelled(jobId)

      unregisterManimProcess(jobId)



      if (cancelled) {

        logger.warn(`Job ${jobId}: Manim cancelled`, { elapsed: `${elapsed}s` })

        resolve({ success: false, stdout, stderr: 'Job cancelled', peakMemoryMB: peakMemory })

        return

      }



      logger.error(`Job ${jobId}: Manim 进程启动失败`, {

        elapsed: `${elapsed}s`,

        errorMessage: error.message,

        errorStack: error.stack

      })

      resolve({ success: false, stdout, stderr: error.message, peakMemoryMB: peakMemory })

    })

  })

}









