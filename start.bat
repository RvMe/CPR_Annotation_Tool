@echo off
REM 医学影像标注工具 - Windows启动脚本

echo ========================================
echo 医学影像标注工具
echo ========================================
echo.

REM 检查Python是否安装
python --version >nul 2>&1
if errorlevel 1 (
    echo 错误: 未检测到Python,请先安装Python 3.8或更高版本
    pause
    exit /b 1
)

echo 正在检查依赖...
pip show Flask >nul 2>&1
if errorlevel 1 (
    echo 正在安装依赖包...
    pip install -r requirements.txt
    if errorlevel 1 (
        echo 依赖安装失败,请检查网络连接
        pause
        exit /b 1
    )
)

echo.
echo 正在启动服务器...
echo 服务器地址: http://127.0.0.1:5000
echo 按 Ctrl+C 停止服务器
echo ========================================
echo.

python app.py

pause
