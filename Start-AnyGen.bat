@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\start-workbench.ps1" -NoBrowser
set "EXITCODE=%ERRORLEVEL%"

if "%EXITCODE%"=="0" (
  start "" "http://127.0.0.1:4318/"
)

if not "%EXITCODE%"=="0" (
  echo.
  echo Launch failed. Press any key to close.
  pause >nul
)

exit /b %EXITCODE%
