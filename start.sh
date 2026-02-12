#!/bin/bash
# 医学影像标注工具 - Linux/macOS启动脚本

echo "========================================"
echo "医学影像标注工具"
echo "========================================"
echo ""

# 检查Python是否安装
if ! command -v python3 &> /dev/null; then
    echo "错误: 未检测到Python3,请先安装Python 3.8或更高版本"
    exit 1
fi

# 检查依赖
echo "正在检查依赖..."
if ! python3 -c "import flask" 2>/dev/null; then
    echo "正在安装依赖包..."
    pip3 install -r requirements.txt
    if [ $? -ne 0 ]; then
        echo "依赖安装失败,请检查网络连接"
        exit 1
    fi
fi

echo ""
echo "正在启动服务器..."
echo "服务器地址: http://127.0.0.1:5000"
echo "按 Ctrl+C 停止服务器"
echo "========================================"
echo ""

python3 app.py
