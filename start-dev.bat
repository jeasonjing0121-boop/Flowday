@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo.
echo  ============================================
echo   FlowDay - 启动开发服务器
echo  ============================================
echo.
echo  启动后请在浏览器（Chrome / Edge）打开：
echo      http://127.0.0.1:5173/
echo.
echo  关闭本窗口即可停止服务。
echo.
call npm run dev
echo.
echo 服务已停止。如果上方有报错，请先确认：
echo   1) 已安装 Node.js（命令行执行 node -v 有版本号）
echo   2) 在 flowday 目录执行过 npm install
echo.
pause
