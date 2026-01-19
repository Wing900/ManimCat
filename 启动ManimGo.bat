@echo off
chcp 65001 >nul
title ManimGo 启动助手

echo ========================================
echo    ManimGo 视频生成服务启动助手
echo ========================================
echo.

REM 检查 Node.js
echo [1/4] 检查 Node.js...
node --version >nul 2>&1
if errorlevel 1 (
    echo ❌ 未检测到 Node.js！
    echo 请先安装 Node.js: https://nodejs.org/
    pause
    exit /b 1
)
echo ✅ Node.js 已安装

REM 检查 Redis
echo.
echo [2/4] 检查 Redis...
set REDIS_FOUND=0

REM 尝试 Memurai
memurai-cli ping >nul 2>&1
if not errorlevel 1 (
    echo ✅ 检测到 Memurai Redis
    set REDIS_FOUND=1
    goto :redis_ok
)

REM 尝试 Redis for Windows
redis-cli ping >nul 2>&1
if not errorlevel 1 (
    echo ✅ 检测到 Redis for Windows
    set REDIS_FOUND=1
    goto :redis_ok
)

REM Redis 未安装
if %REDIS_FOUND%==0 (
    echo ❌ 未检测到 Redis！
    echo.
    echo 请先安装 Redis，有两个选择：
    echo.
    echo 【推荐】Memurai (官方 Windows 版):
    echo   下载地址: https://www.memurai.com/get-memurai
    echo.
    echo 或者 Redis for Windows:
    echo   下载地址: https://github.com/tporadowski/redis/releases
    echo.
    echo 详细安装说明请查看: Windows安装Redis指南.md
    echo.
    pause
    exit /b 1
)

:redis_ok
echo.
echo [3/4] 启动 Redis 服务...

REM 尝试启动 Memurai 服务
net start memurai >nul 2>&1
if not errorlevel 1 (
    echo ✅ Memurai 服务已启动
    goto :start_app
)

REM 尝试启动 Redis 服务
net start redis >nul 2>&1
if not errorlevel 1 (
    echo ✅ Redis 服务已启动
    goto :start_app
)

REM Redis 服务可能已经在运行
echo ℹ️  Redis 服务已在运行

:start_app
echo.
echo [4/4] 启动 ManimGo 服务器...
echo.
echo ========================================
echo   🚀 服务器正在启动...
echo   📝 访问地址: http://localhost:3000
echo   🔍 健康检查: http://localhost:3000/health
echo   
echo   按 Ctrl+C 可停止服务器
echo ========================================
echo.

REM 启动开发服务器
npm run dev