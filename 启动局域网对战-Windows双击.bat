@echo off
chcp 65001 >nul
title Saltline - LAN Multiplayer
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo [!] 未检测到 Node.js，请先安装长期支持版: https://nodejs.org
  echo     安装完成后重新双击本文件即可。
  pause
  exit /b 1
)

if not exist "node_modules\ws" (
  echo 首次运行：安装运行依赖（仅 ws，约 200KB）...
  call npm install --omit=dev
  if errorlevel 1 (
    echo [!] 依赖安装失败，请检查网络后重试，或手动执行: npm install --omit=dev
    pause
    exit /b 1
  )
)

if not exist "dist\index.html" (
  echo 首次运行：构建游戏（需要完整依赖）...
  call npm install
  call npm run build
)

echo 正在启动局域网对战服务...
start "" cmd /c "timeout /t 2 /nobreak >nul && start http://localhost:8080"
node server\standalone.mjs
pause
