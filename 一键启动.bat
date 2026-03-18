@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"

powershell -NoProfile -Command "Get-CimInstance Win32_Process -Filter \"name = 'node.exe'\" | Where-Object { $_.CommandLine -like '*D:\AICode\anygen-pL*server.js*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }" >nul 2>nul

where node >nul 2>nul
if errorlevel 1 (
  echo 未检测到 Node.js，请先安装 Node.js 20+。
  pause
  exit /b 1
)

where npm >nul 2>nul
if errorlevel 1 (
  echo 未检测到 npm，请先安装 Node.js 自带的 npm。
  pause
  exit /b 1
)

if not exist "node_modules" (
  echo 首次启动，正在自动安装依赖，请稍等...
  call npm install
  if errorlevel 1 (
    echo 依赖安装失败，请把这个窗口截图给我。
    pause
    exit /b 1
  )
)

node scripts\prepare-config.mjs
start "AnyGen Workbench Server" /min cmd /k "cd /d %~dp0 && node server.js"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\wait-for-workbench.ps1"
if errorlevel 1 (
  echo 启动失败，请看上面的报错。
  pause
  exit /b 1
)
exit /b 0
