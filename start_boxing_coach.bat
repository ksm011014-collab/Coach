@echo off
setlocal

set "APP_DIR=%~dp0box"
set "APP_URL=http://127.0.0.1:8000"
set "PYTHON_EXE="
set "PYTHON_ARGS="

if exist "%APP_DIR%\.venv\Scripts\python.exe" (
    set "PYTHON_EXE=%APP_DIR%\.venv\Scripts\python.exe"
) else (
    py -3 --version >nul 2>&1
    if not errorlevel 1 (
        set "PYTHON_EXE=py"
        set "PYTHON_ARGS=-3"
    ) else (
        python --version >nul 2>&1
        if not errorlevel 1 (
            set "PYTHON_EXE=python"
        )
    )
)

if not defined PYTHON_EXE (
    echo Python could not be found.
    echo Install Python 3, or create a virtual environment at "%APP_DIR%\.venv".
    pause
    exit /b 1
)

cd /d "%APP_DIR%" || (
    echo App directory was not found: "%APP_DIR%"
    pause
    exit /b 1
)

echo Starting Boxing AI Coach MVP...
start "Boxing AI Coach MVP Server" /d "%APP_DIR%" cmd /k ""%PYTHON_EXE%" %PYTHON_ARGS% backend\server.py"
timeout /t 2 /nobreak >nul

echo Opening %APP_URL%
start "" "%APP_URL%"

echo.
echo Server is running in the new command window.
echo Close that window to stop the server.
timeout /t 3 /nobreak >nul
