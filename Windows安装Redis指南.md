# Windows 本地安装 Redis 完整指南

## ⚠️ 重要提示

**Memurai Developer 版本有使用限制**：
- 最多运行 10 天自动关闭
- 最多 10 个连接
- 最多使用 50% 内存

**因此推荐使用 Redis for Windows (完全免费，无限制)！**

---

## 方法一：Redis for Windows (推荐，完全免费) ⭐

**这是社区维护的官方 Windows 移植版本，完全免费，无任何限制。**

### 下载

1. **访问 GitHub Release 页面**:
   https://github.com/tporadowski/redis/releases

2. **下载最新版** (推荐 5.0.14.1):
   - `Redis-x64-5.0.14.1.msi` (安装版，推荐) ⭐
   - 或 `Redis-x64-5.0.14.1.zip` (绿色版)

### 安装 (.msi 安装版)

```
1. 双击 Redis-x64-5.0.14.1.msi
2. 点击 "Next"
3. ✅ 勾选 "Add Redis to PATH" (重要！)
4. ✅ 勾选 "Install Redis as Windows Service" (自动启动)
5. 端口保持默认 6379
6. 最大内存保持默认
7. 点击 "Install"
8. 完成！
```

### 验证安装

```cmd
# 测试连接
redis-cli ping
# 应该返回: PONG ✅
```

### 启动和管理

**作为服务运行** (推荐，已自动启动):
```cmd
# 查看服务状态
sc query redis

# 启动服务 (如果未启动)
net start redis

# 停止服务
net stop redis

# 重启服务
net stop redis && net start redis
```

**手动运行** (如果不想用服务):
```cmd
# 启动 Redis
redis-server

# 或指定配置文件
redis-server redis.windows.conf
```

**管理命令**:
```cmd
# 连接到 Redis
redis-cli

# 查看信息
redis-cli info

# 测试连接
redis-cli ping

# 设置值
redis-cli SET test "Hello"

# 获取值
redis-cli GET test
```

### 配置文件位置

- **安装版**: `C:\Program Files\Redis\redis.windows-service.conf`
- **绿色版**: 解压目录下的 `redis.windows.conf`

基本不需要修改，默认配置已足够使用。

---

## 方法二：使用 Memurai (付费版无限制)

**⚠️ 注意**: Memurai Developer 免费版有限制，不推荐长期使用。

3. **安装步骤**
   ```
   1. 双击 .msi 安装包
   2. 点击 "Next" 
   3. 选择安装路径 (默认: C:\Program Files\Memurai)
   4. 勾选 "Add Memurai to PATH" ✅ (重要！)
   5. 勾选 "Install Memurai as Windows Service" ✅ (自动启动)
   6. 点击 "Install"
   7. 完成！
   ```

4. **验证安装**
   ```cmd
   # 打开 CMD 或 PowerShell
   memurai-cli ping
   # 应该返回: PONG
   ```

### 配置（可选）

默认配置已经足够，但如果需要修改：

配置文件位置: `C:\Program Files\Memurai\memurai.conf`

```conf
# 端口 (默认 6379，无需修改)
port 6379

# 绑定地址 (默认 127.0.0.1，无需修改)
bind 127.0.0.1

# 持久化 (默认开启)
save 900 1
save 300 10
save 60 10000
```

### 启动和管理

**作为服务运行** (推荐):
```cmd
# 启动服务
net start memurai

# 停止服务
net stop memurai

# 重启服务
net stop memurai && net start memurai
```

**手动运行**:
```cmd
# 启动 Redis
memurai-server

# 或指定配置文件
memurai-server "C:\Program Files\Memurai\memurai.conf"
```

**查看状态**:
```cmd
# 连接到 Redis
memurai-cli

# 查看信息
memurai-cli info

# 测试连接
memurai-cli ping
```

---

## 方法二：使用 Redis for Windows (非官方但流行)

**注意**: 这是社区维护的 Windows 移植版本，已停止更新，但仍可用。

### 下载

1. 访问 GitHub Release 页面:
   https://github.com/tporadowski/redis/releases

2. 下载最新版 (推荐 5.0.14.1):
   - `Redis-x64-5.0.14.1.msi` (安装版)
   - 或 `Redis-x64-5.0.14.1.zip` (绿色版)

### 安装版 (.msi)

```
1. 双击 .msi 文件
2. 勾选 "Add Redis to PATH"
3. 勾选 "Install Redis as Windows Service"
4. 选择端口 (默认 6379)
5. 点击 "Install"
```

### 绿色版 (.zip)

```
1. 解压到任意目录，如: C:\Redis
2. 打开 CMD，进入解压目录
3. 启动 Redis:
   redis-server.exe redis.windows.conf
```

### 验证安装

```cmd
# 测试连接
redis-cli ping
# 应该返回: PONG
```

---

## 方法三：使用 WSL2 + Linux Redis (最接近生产环境)

如果你启用了 WSL2，可以在 Linux 子系统中安装 Redis。

### 步骤

```bash
# 1. 打开 WSL2 终端 (Ubuntu)
wsl

# 2. 更新包管理器
sudo apt update

# 3. 安装 Redis
sudo apt install redis-server -y

# 4. 启动 Redis
sudo service redis-server start

# 5. 测试连接
redis-cli ping
# 应该返回: PONG
```

### Windows 访问 WSL2 Redis

WSL2 的 Redis 默认只监听 `127.0.0.1`，需要配置才能从 Windows 访问：

```bash
# 编辑配置
sudo nano /etc/redis/redis.conf

# 找到并修改:
bind 0.0.0.0  # 改为监听所有地址

# 重启 Redis
sudo service redis-server restart
```

然后在 Windows 中通过 WSL2 IP 连接（可在 WSL 中运行 `ip addr` 查看）。

---

## 推荐选择

| 方法 | 优点 | 缺点 | 推荐度 |
|------|------|------|--------|
| **Memurai** | 官方推荐，最新，稳定 | 需要注册账号 | ⭐⭐⭐⭐⭐ |
| **Redis for Windows** | 简单，免注册 | 停止更新 (5.0.14) | ⭐⭐⭐⭐ |
| **WSL2** | 最接近生产环境 | 需要 WSL2 | ⭐⭐⭐ |

**如果不想折腾，直接选 Memurai！**

---

## 安装后验证

### 1. 测试连接
```cmd
memurai-cli ping
# 或
redis-cli ping
```

### 2. 设置和获取值
```cmd
memurai-cli
> SET test "Hello Redis"
> GET test
"Hello Redis"
> exit
```

### 3. 查看 Redis 信息
```cmd
memurai-cli info server
```

---

## 常见问题

### Q1: 提示 "redis-cli 不是内部或外部命令"
**解决**: 添加到 PATH 环境变量
```
1. 右键"此电脑" -> "属性" -> "高级系统设置"
2. 点击"环境变量"
3. 在"系统变量"中找到"Path"
4. 添加 Redis 安装目录，如: C:\Program Files\Memurai
5. 重启 CMD
```

### Q2: 端口 6379 被占用
**解决**: 查找并停止占用进程
```cmd
# 查找占用端口的进程
netstat -ano | findstr :6379

# 停止进程 (PID 为上面查到的数字)
taskkill /PID <PID> /F
```

### Q3: Redis 服务启动失败
**解决**: 查看日志
```cmd
# Memurai 日志位置
C:\Program Files\Memurai\Logs\memurai.log

# Redis for Windows 日志位置
C:\Program Files\Redis\Logs\redis_log.txt
```

---

## 连接 ManimGo 项目

安装好 Redis 后，ManimGo 会自动连接到 `localhost:6379`。

### 验证连接

1. 启动 Redis
```cmd
net start memurai
```

2. 启动 ManimGo
```cmd
npm run dev
```

3. 检查健康状态
```cmd
curl http://localhost:3000/health
```

应该看到:
```json
{
  "status": "healthy",
  "redis": {
    "status": "connected"  // ✅ 成功
  }
}
```

---

## 快速启动脚本

我已经为你准备了一个启动脚本，下载后直接双击运行！

**使用方法**:
1. 确保 Redis 已安装（Memurai 或 Redis for Windows）
2. 双击 `启动ManimGo.bat`
3. 等待服务启动
4. 访问 http://localhost:3000

就这么简单！