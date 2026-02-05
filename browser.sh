#!/bin/bash

# 获取脚本所在目录，确保路径正确
DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
cd "$DIR"

# --- 颜色定义 ---
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

echo -e "${GREEN}[INFO] 正在初始化浏览器访问环境 (Cloud/Headless Mode)...${NC}"

if [ -f "$DIR/python/bin/python" ]; then
    echo -e "${GREEN}[INFO] 检测到 Python 虚拟环境。${NC}"
else
    echo -e "${YELLOW}[INFO] 未检测到 Python 环境，正在通过系统 Python 创建虚拟环境...${NC}"
    
    if ! command -v python3 &> /dev/null; then
        echo -e "${RED}[ERROR] 未找到 python3。请先在您的 Linux 系统中安装 Python 3.10+。${NC}"
        exit 1
    fi

    # 创建 venv
    python3 -m venv "$DIR/python"
    if [ $? -ne 0 ]; then
        echo -e "${RED}[ERROR] 虚拟环境创建失败。${NC}"
        exit 1
    fi
    echo -e "${GREEN}[INFO] Python 环境创建完成。${NC}"
fi

# 设置环境变量 PATH
export PATH="$DIR/python/bin:$PATH"

# --- 启动 Python IPC 桥接服务器 ---
echo -e "${GREEN}[INFO] 正在启动 Python IPC 桥接服务 (Port 5001)...${NC}"
python app/web_server.py > logs/web_bridge.log 2>&1 &
BRIDGE_PID=$!

# 退出时杀掉桥接进程
trap "kill $BRIDGE_PID" EXIT

# --- 检测 Node.js ---
echo -e "${GREEN}[INFO] 检查 Node.js 环境...${NC}"
if ! command -v node &> /dev/null; then
    echo -e "${RED}[ERROR] 未检测到 Node.js。请安装 Node.js v22+。${NC}"
    exit 1
fi

# --- 启动 UI ---
if [ -d "app/ui" ]; then
    cd app/ui
else
    echo -e "${RED}[ERROR] 找不到目录 app/ui。${NC}"
    exit 1
fi

# 检查依赖
if [ ! -d "node_modules" ]; then
    echo -e "${YELLOW}[INFO] 检测到依赖缺失，正在安装...${NC}"
    npm install
fi

echo -e "${GREEN}=========================================="
echo -e "      DiffPipe Forge Web 访问模式"
echo -e "=========================================="
echo -e "本地端口: 5173"
echo -e "如果是云端平台，请确保 5173 (UI) 和 5001 (API) 端口已转发。"
echo -e "==========================================${NC}"

# 启动 Vite (监听所有接口)
npm run dev -- --host 0.0.0.0
