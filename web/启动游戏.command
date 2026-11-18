#!/bin/bash
# 双击启动：在本机开一个小服务器，用默认浏览器打开游戏。关掉这个终端窗口就停止。
cd "$(dirname "$0")"
PORT=8777
while lsof -iTCP:$PORT -sTCP:LISTEN >/dev/null 2>&1; do PORT=$((PORT+1)); done
python3 -m http.server $PORT --bind 127.0.0.1 >/dev/null 2>&1 &
SRV=$!
sleep 1
open "http://localhost:$PORT/cn.html"
echo "游戏已在浏览器打开：http://localhost:$PORT/cn.html"
echo "玩完关掉这个窗口即可。"
trap "kill $SRV 2>/dev/null" EXIT
wait $SRV
