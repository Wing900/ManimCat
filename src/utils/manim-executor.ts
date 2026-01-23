/**
 * Manim 执行器
 * 执行 Manim 命令，管理子进程
 */

import { spawn } from 'child_process'
import { createLogger } from './logger'

const logger = createLogger('ManimExecutor')

/**
 * Manim 执行结果
 */
export interface ManimExecutionResult {
  success: boolean
  stdout: string
  stderr: string
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
  return new Promise((resolve) => {
    const platform = process.platform

    if (platform === 'win32') {
      // Windows: 使用 wmic 获取进程内存
      spawn('wmic', ['process', 'where', `ProcessId=${pid}`, 'get', 'WorkingSetSize', '/value'])
        .stdout.on('data', (data) => {
          const output = data.toString()
          const match = output.match(/WorkingSetSize=(\d+)/)
          if (match) {
            // 转换为 MB
            const bytes = parseInt(match[1], 10)
            resolve(Math.round(bytes / 1024 / 1024))
          } else {
            resolve(null)
          }
        })
        .on('error', () => resolve(null))
        .on('close', () => resolve(null))
    } else {
      // Linux/Mac: 使用 ps 获取进程内存
      spawn('ps', ['-o', 'rss=', '-p', pid.toString()])
        .stdout.on('data', (data) => {
          const output = data.toString().trim()
          if (output) {
            // ps 返回的是 KB，转换为 MB
            const kb = parseInt(output, 10)
            resolve(Math.round(kb / 1024))
          } else {
            resolve(null)
          }
        })
        .on('error', () => resolve(null))
        .on('close', () => resolve(null))
    }
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

    let stdout = ''
    let stderr = ''
    let lastProgressTime = Date.now()
    let lastLogTime = Date.now()
    let peakMemory = 0 // 峰值内存（MB）

    // 内存监控定时器（每2秒检查一次）
    const memoryMonitor = setInterval(async () => {
      if (proc.pid) {
        const memory = await getProcessMemory(proc.pid)
        if (memory) {
          if (memory > peakMemory) {
            peakMemory = memory
          }
          logger.info(`Job ${jobId}: Manim 内存使用`, {
            memoryMB: memory,
            peakMemoryMB: peakMemory
          })
        }
      }
    }, 2000)

    proc.stdout.on('data', (data) => {
      const text = data.toString()
      stdout += text

      // 实时输出所有 stdout（每5秒批量输出一次，避免过于频繁）
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

    // 设置超时（5分钟）
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
        stderr: stderr || 'Manim render timeout (5 minutes)'
      })
    }, 5 * 60 * 1000)

    proc.on('close', (code) => {
      clearTimeout(timeout)
      clearInterval(memoryMonitor)
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1)
      if (code === 0) {
        logger.info(`Job ${jobId}: Manim 成功完成`, {
          elapsed: `${elapsed}s`,
          exitCode: code,
          stdoutLength: stdout.length,
          stderrLength: stderr.length,
          peakMemoryMB: peakMemory
        })
        resolve({ success: true, stdout, stderr })
      } else {
        logger.error(`Job ${jobId}: Manim 退出异常`, {
          elapsed: `${elapsed}s`,
          exitCode: code,
          stdoutLength: stdout.length,
          stderrLength: stderr.length,
          stderrPreview: stderr.slice(-500),
          peakMemoryMB: peakMemory
        })
        resolve({ success: false, stdout, stderr })
      }
    })

    proc.on('error', (error) => {
      clearTimeout(timeout)
      clearInterval(memoryMonitor)
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1)
      logger.error(`Job ${jobId}: Manim 进程启动失败`, {
        elapsed: `${elapsed}s`,
        errorMessage: error.message,
        errorStack: error.stack
      })
      resolve({ success: false, stdout, stderr: error.message })
    })
  })
}
