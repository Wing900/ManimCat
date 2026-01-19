const { spawn } = require('child_process');
const RedisServer = require('redis-server');

// Create Redis server instance
const redisServer = new RedisServer(6379);

console.log('🚀 Starting Redis server on port 6379...');

redisServer.open((err) => {
  if (err) {
    console.error('❌ Failed to start Redis:', err);
    process.exit(1);
  }

  console.log('✅ Redis server started successfully');
  console.log('🚀 Starting Motia development server...\n');

  // Start Motia dev server
  const motia = spawn('npm', ['run', 'dev:no-redis'], {
    stdio: 'inherit',
    shell: true
  });

  // Handle Motia process exit
  motia.on('exit', (code) => {
    console.log('\n🛑 Motia server stopped');
    redisServer.close();
    process.exit(code);
  });

  // Handle Ctrl+C
  process.on('SIGINT', () => {
    console.log('\n🛑 Shutting down servers...');
    motia.kill();
    redisServer.close();
    process.exit(0);
  });
});