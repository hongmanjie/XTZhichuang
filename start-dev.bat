@echo off
rem ============================================================
rem  兴图智创 XingTu Studio - 本地开发模式启动脚本
rem  前端: http://localhost:5173 (Vite HMR)
rem  后端: http://localhost:3001 (Express API)
rem  注意: 若 Docker 容器已占用 3001，后端 dev server 会跳过
rem ============================================================
chcp 65001 >nul
cd /d %~dp0

echo [1/2] 启动后端 API (:3001)...
start "yimetai-server" cmd /k "cd /d %~dp0server && node src\index.js"

echo [2/2] 启动前端 Dev Server (:5173)...
start "yimetai-client" cmd /k "cd /d %~dp0client && npm run dev"

echo.
echo 已启动两个窗口:
echo   - 后端 API : http://localhost:3001
echo   - 前端页面 : http://localhost:5173
echo.
echo 关闭对应的 cmd 窗口即可停止服务。
pause
