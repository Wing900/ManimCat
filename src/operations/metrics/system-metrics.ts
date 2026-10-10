import os from 'os'

export function getSystemMemory() {
  const total = os.totalmem()
  const free = os.freemem()
  const used = total - free

  return {
    total: {
      bytes: total,
      gb: Math.round((total / 1024 / 1024 / 1024) * 100) / 100
    },
    used: {
      bytes: used,
      gb: Math.round((used / 1024 / 1024 / 1024) * 100) / 100
    },
    free: {
      bytes: free,
      gb: Math.round((free / 1024 / 1024 / 1024) * 100) / 100
    },
    usagePercent: Math.round((used / total) * 100 * 100) / 100
  }
}

export function getCPUInfo() {
  const cpus = os.cpus()
  const loadAvg = os.loadavg()

  return {
    cores: cpus.length,
    model: cpus[0]?.model || 'Unknown',
    speed: cpus[0]?.speed || 0,
    loadAverage: {
      '1min': Math.round(loadAvg[0] * 100) / 100,
      '5min': Math.round(loadAvg[1] * 100) / 100,
      '15min': Math.round(loadAvg[2] * 100) / 100
    }
  }
}

function formatUptime(seconds: number): string {
  const days = Math.floor(seconds / 86400)
  const hours = Math.floor((seconds % 86400) / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  const secs = Math.floor(seconds % 60)

  const parts = []
  if (days > 0) parts.push(`${days}d`)
  if (hours > 0) parts.push(`${hours}h`)
  if (minutes > 0) parts.push(`${minutes}m`)
  parts.push(`${secs}s`)

  return parts.join(' ')
}

export function getRuntimeInfo() {
  const uptime = process.uptime()

  return {
    uptime: {
      seconds: Math.round(uptime),
      formatted: formatUptime(uptime)
    },
    platform: os.platform(),
    arch: os.arch(),
    nodeVersion: process.version,
    pid: process.pid
  }
}
