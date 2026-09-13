@echo off
setlocal
cd /d "%~dp0"
set BOXING_COACH_HOST=0.0.0.0
if "%BOXING_COACH_PORT%"=="" set BOXING_COACH_PORT=8000
echo LAN mode enabled. Open this PC's LAN IP on port %BOXING_COACH_PORT% from another device.
call "%~dp0start_windows.bat"
exit /b %ERRORLEVEL%
