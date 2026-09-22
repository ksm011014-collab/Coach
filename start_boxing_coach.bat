@echo off
setlocal
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0box\tools\start-local.ps1"
if errorlevel 1 (
    echo BoxingCoach could not start. See the error above.
    pause
    exit /b 1
)
