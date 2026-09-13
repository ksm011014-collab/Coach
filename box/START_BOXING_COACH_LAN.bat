@echo off
setlocal
cd /d "%~dp0BoxingCoach"

set PYTHONNOUSERSITE=1
set BOXING_COACH_HOST=0.0.0.0
if "%BOXING_COACH_PORT%"=="" set BOXING_COACH_PORT=8000

echo Starting BoxingCoach in LAN mode...
echo Use this PC's local network IP address on port %BOXING_COACH_PORT%.
"%~dp0runtime\python\python.exe" "backend\server.py"

if errorlevel 1 (
    echo.
    echo BoxingCoach stopped with an error.
    pause
)
