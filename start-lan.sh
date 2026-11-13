#!/bin/bash
# Saltline — Linux 局域网对战启动器
cd "$(dirname "$0")"

if ! command -v node >/dev/null 2>&1; then
  echo "[!] 未检测到 Node.js，请先安装: https://nodejs.org"
  exit 1
fi

if [ ! -d node_modules/ws ]; then
  echo "首次运行：安装运行依赖（仅 ws）..."
  npm install --omit=dev || exit 1
fi

if [ ! -f dist/index.html ]; then
  echo "首次运行：构建游戏..."
  npm install && npm run build
fi

echo "正在启动局域网对战服务..."
( sleep 2; xdg-open "http://localhost:8080" 2>/dev/null ) &
node server/standalone.mjs
