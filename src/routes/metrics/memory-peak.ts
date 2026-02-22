import os from 'os'

type ProcessMemorySnapshot = Pick<NodeJS.MemoryUsage, 'rss' | 'heapTotal' | 'heapUsed' | 'external'>

const memorySampleIntervalMs = Math.max(Number(process.env.MEMORY_SAMPLE_INTERVAL_MS || 2000), 250)

const memoryPeakState = {
  since: new Date().toISOString(),
  lastSampleAt: new Date().toISOString(),
  process: {
    rss: 0,
    heapTotal: 0,
    heapUsed: 0,
    external: 0
  },
  system: {
    used: 0,
    usagePercent: 0
  }
}

function formatProcessMemory(usage: ProcessMemorySnapshot) {
  return {
    rss: {
      bytes: usage.rss,
      mb: Math.round((usage.rss / 1024 / 1024) * 100) / 100
    },
    heapTotal: {
      bytes: usage.heapTotal,
      mb: Math.round((usage.heapTotal / 1024 / 1024) * 100) / 100
    },
    heapUsed: {
      bytes: usage.heapUsed,
      mb: Math.round((usage.heapUsed / 1024 / 1024) * 100) / 100
    },
    external: {
      bytes: usage.external,
      mb: Math.round((usage.external / 1024 / 1024) * 100) / 100
    }
  }
}

function formatSystemUsed(bytes: number) {
  return {
    bytes,
    gb: Math.round((bytes / 1024 / 1024 / 1024) * 100) / 100
  }
}

function updateMemoryPeaks() {
  const usage = process.memoryUsage()
  const total = os.totalmem()
  const free = os.freemem()
  const used = total - free
  const usagePercent = Math.round((used / total) * 100 * 100) / 100

  memoryPeakState.lastSampleAt = new Date().toISOString()

  if (usage.rss > memoryPeakState.process.rss) memoryPeakState.process.rss = usage.rss
  if (usage.heapTotal > memoryPeakState.process.heapTotal) memoryPeakState.process.heapTotal = usage.heapTotal
  if (usage.heapUsed > memoryPeakState.process.heapUsed) memoryPeakState.process.heapUsed = usage.heapUsed
  if (usage.external > memoryPeakState.process.external) memoryPeakState.process.external = usage.external
  if (used > memoryPeakState.system.used) memoryPeakState.system.used = used
  if (usagePercent > memoryPeakState.system.usagePercent) memoryPeakState.system.usagePercent = usagePercent
}

function resetMemoryPeaksInternal() {
  const usage = process.memoryUsage()
  const total = os.totalmem()
  const free = os.freemem()
  const used = total - free
  const usagePercent = Math.round((used / total) * 100 * 100) / 100
  const now = new Date().toISOString()

  memoryPeakState.since = now
  memoryPeakState.lastSampleAt = now
  memoryPeakState.process = {
    rss: usage.rss,
    heapTotal: usage.heapTotal,
    heapUsed: usage.heapUsed,
    external: usage.external
  }
  memoryPeakState.system = {
    used,
    usagePercent
  }
}

export function getProcessMemorySnapshot() {
  return formatProcessMemory(process.memoryUsage())
}

export function getMemoryPeakSnapshot() {
  updateMemoryPeaks()

  return {
    since: memoryPeakState.since,
    lastSampleAt: memoryPeakState.lastSampleAt,
    sampleIntervalMs: memorySampleIntervalMs,
    process: formatProcessMemory(memoryPeakState.process),
    system: {
      used: formatSystemUsed(memoryPeakState.system.used),
      usagePercent: memoryPeakState.system.usagePercent
    }
  }
}

export function resetMemoryPeaks() {
  resetMemoryPeaksInternal()
}

export function startMemoryPeakSampler(): () => void {
  resetMemoryPeaksInternal()
  const memorySampleTimer = setInterval(updateMemoryPeaks, memorySampleIntervalMs)
  memorySampleTimer.unref()
  return () => clearInterval(memorySampleTimer)
}
