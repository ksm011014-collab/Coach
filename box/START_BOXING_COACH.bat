@echo off
setlocal
cd /d "%~dp0BoxingCoach"

set PYTHONNOUSERSITE=1
set BOXING_COACH_HOST=127.0.0.1
if "%BOXING_COACH_PORT%"=="" set BOXING_COACH_PORT=8000

echo Starting BoxingCoach...
echo The app will open in your browser automatically.
"%~dp0runtime\python\python.exe" "backend\server.py"

if errorlevel 1 (
    echo.
    echo BoxingCoach stopped with an error.
    pause
)
