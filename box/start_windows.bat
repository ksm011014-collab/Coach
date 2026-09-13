@echo off
setlocal
cd /d "%~dp0"

if "%BOXING_COACH_HOST%"=="" set BOXING_COACH_HOST=127.0.0.1
if "%BOXING_COACH_PORT%"=="" set BOXING_COACH_PORT=8000

if not exist ".venv\Scripts\python.exe" (
    call "%~dp0install_windows.bat"
    if errorlevel 1 exit /b 1
)

echo Boxing AI Coach will run at http://%BOXING_COACH_HOST%:%BOXING_COACH_PORT%
".venv\Scripts\python.exe" "backend\server.py"
exit /b %ERRORLEVEL%
