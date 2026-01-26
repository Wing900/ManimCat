/**
 * HuggingFace Spaces Redis startup script.
 * Runs Redis and the Node.js app in the same container.
 */

const { spawn, execSync } = require('child_process')
const fs = require('fs')

console.log('ManimCat HuggingFace Spaces startup script')
console.log('============================================')

const REDIS_PORT = process.env.REDIS_PORT || 6379
const REDIS_DIR = '/data/redis'
const REDIS_CONFIG = {
  port: REDIS_PORT,
  dir: REDIS_DIR,
  maxmemory: process.env.REDIS_MAXMEMORY || '256mb',
  maxmemoryPolicy: 'allkeys-lru',
  appendonly: 'yes',
  appendfsync: 'everysec',
  daemonize: 'yes'
}

function ensureRedisDir() {
  try {
    if (!fs.existsSync(REDIS_DIR)) {
      fs.mkdirSync(REDIS_DIR, { recursive: true, mode: 0o755 })
      console.log(`Created Redis data directory: ${REDIS_DIR}`)
    }
  } catch (error) {
    console.error(`Failed to create Redis directory: ${error.message}`)
    process.exit(1)
  }
}

function startRedis() {
  return new Promise((resolve, reject) => {
    console.log(`Starting Redis server on port ${REDIS_PORT}...`)

    const redisArgs = [
      '--port', REDIS_PORT.toString(),
      '--dir', REDIS_DIR,
      '--maxmemory', REDIS_CONFIG.maxmemory,
      '--maxmemory-policy', REDIS_CONFIG.maxmemoryPolicy,
      '--appendonly', REDIS_CONFIG.appendonly,
      '--appendfsync', REDIS_CONFIG.appendfsync,
      '--daemonize', REDIS_CONFIG.daemonize
    ]

    try {
      execSync(`redis-server ${redisArgs.join(' ')}`, { stdio: 'pipe' })
      console.log('Redis server started successfully')

      setTimeout(() => {
        try {
          execSync('redis-cli ping', { stdio: 'pipe' })
          console.log('Redis is ready and responding to PING')
          resolve()
        } catch (error) {
          reject(new Error('Redis started but not responding to PING'))
        }
      }, 2000)
    } catch (error) {
      reject(new Error(`Failed to start Redis: ${error.message}`))
    }
  })
}

function startNodeApp() {
  return new Promise((resolve, reject) => {
    console.log('Starting Node.js application...')

    const nodeApp = spawn('node', ['dist/server.js'], {
      stdio: 'inherit',
      env: {
        ...process.env,
        REDIS_HOST: 'localhost',
        REDIS_PORT: REDIS_PORT.toString()
      }
    })

    nodeApp.on('error', (error) => {
      console.error('Failed to start Node.js application:', error)
      reject(error)
    })

    nodeApp.on('exit', (code, signal) => {
      if (signal) {
        console.log(`Node.js application stopped by signal ${signal}`)
      } else {
        console.log(`Node.js application exited with code ${code}`)
      }

      cleanup()
      process.exit(code || 0)
    })

    resolve(nodeApp)
  })
}

function cleanup() {
  console.log('Cleaning up resources...')

  try {
    execSync('redis-cli shutdown', { stdio: 'pipe' })
    console.log('Redis server stopped')
  } catch (error) {
    console.warn('Redis may have already stopped')
  }
}

function setupSignalHandlers(nodeApp) {
  const signals = ['SIGINT', 'SIGTERM', 'SIGQUIT']

  signals.forEach((signal) => {
    process.on(signal, () => {
      console.log(`Received ${signal}, shutting down gracefully...`)

      if (nodeApp) {
        nodeApp.kill(signal)
      } else {
        cleanup()
        process.exit(0)
      }
    })
  })

  process.on('uncaughtException', (error) => {
    console.error('Uncaught Exception:', error)
    cleanup()
    process.exit(1)
  })

  process.on('unhandledRejection', (reason, promise) => {
    console.error('Unhandled Rejection at:', promise, 'reason:', reason)
    cleanup()
    process.exit(1)
  })
}

async function main() {
  try {
    ensureRedisDir()
    await startRedis()

    const nodeApp = await startNodeApp()
    setupSignalHandlers(nodeApp)

    console.log('All services started successfully')
    console.log('Application is running on port', process.env.PORT || 7860)
    console.log('Health check:', `http://localhost:${process.env.PORT || 7860}/health`)
    console.log('Press Ctrl+C to stop')
  } catch (error) {
    console.error('Startup failed:', error.message)
    cleanup()
    process.exit(1)
  }
}

main()
