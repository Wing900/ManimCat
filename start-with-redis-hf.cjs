/**
 * HuggingFace Spaces Redis 和应用启动脚本
 * 在同一容器中启动 Redis 和 Node.js 应用
 */

const { spawn, execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

console.log('🚀 ManimCat HuggingFace Spaces Startup Script');
console.log('================================================\n');

// Redis 配置
const REDIS_PORT = process.env.REDIS_PORT || 6379;
const REDIS_DIR = '/data/redis';
const REDIS_CONFIG = {
  port: REDIS_PORT,
  dir: REDIS_DIR,
  maxmemory: process.env.REDIS_MAXMEMORY || '256mb',
  maxmemoryPolicy: 'allkeys-lru',
  appendonly: 'yes',
  appendfsync: 'everysec',
  daemonize: 'yes'
};

/**
 * 确保 Redis 数据目录存在
 */
function ensureRedisDir() {
  try {
    if (!fs.existsSync(REDIS_DIR)) {
      fs.mkdirSync(REDIS_DIR, { recursive: true, mode: 0o755 });
      console.log(`✅ Created Redis data directory: ${REDIS_DIR}`);
    }
  } catch (error) {
    console.error(`❌ Failed to create Redis directory: ${error.message}`);
    process.exit(1);
  }
}

/**
 * 启动 Redis 服务器
 */
function startRedis() {
  return new Promise((resolve, reject) => {
    console.log(`🚀 Starting Redis server on port ${REDIS_PORT}...`);
    
    // 构建 Redis 启动命令
    const redisArgs = [
      '--port', REDIS_PORT.toString(),
      '--dir', REDIS_DIR,
      '--maxmemory', REDIS_CONFIG.maxmemory,
      '--maxmemory-policy', REDIS_CONFIG.maxmemoryPolicy,
      '--appendonly', REDIS_CONFIG.appendonly,
      '--appendfsync', REDIS_CONFIG.appendfsync,
      '--daemonize', REDIS_CONFIG.daemonize
    ];

    try {
      // 启动 Redis 作为后台进程
      execSync(`redis-server ${redisArgs.join(' ')}`, { stdio: 'pipe' });
      console.log('✅ Redis server started successfully');
      
      // 等待 Redis 就绪
      setTimeout(() => {
        try {
          execSync('redis-cli ping', { stdio: 'pipe' });
          console.log('✅ Redis is ready and responding to PING\n');
          resolve();
        } catch (error) {
          reject(new Error('Redis started but not responding to PING'));
        }
      }, 2000);
    } catch (error) {
      reject(new Error(`Failed to start Redis: ${error.message}`));
    }
  });
}

/**
 * 启动 Node.js 应用
 */
function startNodeApp() {
  return new Promise((resolve, reject) => {
    console.log('🚀 Starting Node.js application...\n');
    
    const nodeApp = spawn('node', ['dist/server.js'], {
      stdio: 'inherit',
      env: {
        ...process.env,
        REDIS_HOST: 'localhost',
        REDIS_PORT: REDIS_PORT.toString()
      }
    });

    nodeApp.on('error', (error) => {
      console.error('❌ Failed to start Node.js application:', error);
      reject(error);
    });

    nodeApp.on('exit', (code, signal) => {
      if (signal) {
        console.log(`\n🛑 Node.js application stopped by signal ${signal}`);
      } else {
        console.log(`\n🛑 Node.js application exited with code ${code}`);
      }
      
      // 清理 Redis
      cleanup();
      process.exit(code || 0);
    });

    resolve(nodeApp);
  });
}

/**
 * 清理资源
 */
function cleanup() {
  console.log('\n🧹 Cleaning up resources...');
  
  try {
    execSync('redis-cli shutdown', { stdio: 'pipe' });
    console.log('✅ Redis server stopped');
  } catch (error) {
    console.warn('⚠️  Redis may have already stopped');
  }
}

/**
 * 处理退出信号
 */
function setupSignalHandlers(nodeApp) {
  const signals = ['SIGINT', 'SIGTERM', 'SIGQUIT'];
  
  signals.forEach(signal => {
    process.on(signal, () => {
      console.log(`\n🛑 Received ${signal}, shutting down gracefully...`);
      
      if (nodeApp) {
        nodeApp.kill(signal);
      } else {
        cleanup();
        process.exit(0);
      }
    });
  });

  // 处理未捕获的异常
  process.on('uncaughtException', (error) => {
    console.error('❌ Uncaught Exception:', error);
    cleanup();
    process.exit(1);
  });

  process.on('unhandledRejection', (reason, promise) => {
    console.error('❌ Unhandled Rejection at:', promise, 'reason:', reason);
    cleanup();
    process.exit(1);
  });
}

/**
 * 主启动函数
 */
async function main() {
  try {
    // 1. 确保 Redis 目录存在
    ensureRedisDir();

    // 2. 启动 Redis
    await startRedis();

    // 3. 启动 Node.js 应用
    const nodeApp = await startNodeApp();

    // 4. 设置信号处理
    setupSignalHandlers(nodeApp);

    console.log('✅ All services started successfully');
    console.log('📝 Application is running on port', process.env.PORT || 7860);
    console.log('🔍 Health check: http://localhost:' + (process.env.PORT || 7860) + '/health');
    console.log('\nPress Ctrl+C to stop\n');

  } catch (error) {
    console.error('❌ Startup failed:', error.message);
    cleanup();
    process.exit(1);
  }
}

// 启动应用
main();