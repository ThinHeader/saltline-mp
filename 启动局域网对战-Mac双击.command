#!/bin/bash
# Saltline — macOS 局域网对战启动器（双击 .command 文件运行）
cd "$(dirname "$0")"

if ! command -v node >/dev/null 2>&1; then
  echo "[!] 未检测到 Node.js，请先安装: https://nodejs.org"
  echo "    安装完成后重新双击本文件即可。"
  read -p "按回车键退出..."
  exit 1
fi

if [ ! -d node_modules/ws ]; then
  echo "首次运行：安装运行依赖（仅 ws）..."
  npm install --omit=dev || { echo "[!] 安装失败，请检查网络"; read -p "按回车键退出..."; exit 1; }
fi

if [ ! -f dist/index.html ]; then
  echo "首次运行：构建游戏..."
  npm install && npm run build
fi

echo "正在启动局域网对战服务..."
( sleep 2; open "http://localhost:8080" 2>/dev/null ) &
node server/standalone.mjs
