$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

function Test-PythonCommand {
    param(
        [string]$Command,
        [string[]]$BaseArgs
    )

    try {
        & $Command @BaseArgs -c "import sys; raise SystemExit(0 if (3, 10) <= sys.version_info[:2] <= (3, 11) else 1)" *> $null
        return $LASTEXITCODE -eq 0
    } catch {
        return $false
    }
}

function Find-Python {
    $candidates = @(
        @{ Command = "py"; Args = @("-3.10") },
        @{ Command = "py"; Args = @("-3.11") },
        @{ Command = "python"; Args = @() }
    )

    foreach ($candidate in $candidates) {
        if (Test-PythonCommand -Command $candidate.Command -BaseArgs $candidate.Args) {
            return $candidate
        }
    }

    throw "Python 3.10 or 3.11 was not found. Install Python from https://www.python.org/downloads/windows/ and retry."
}

if (!(Test-Path "requirements.txt")) {
    throw "requirements.txt was not found. Run this script from the BoxingCoach folder."
}

if (!(Test-Path ".venv\Scripts\python.exe")) {
    $python = Find-Python
    Write-Host "Creating virtual environment with $($python.Command) $($python.Args -join ' ')..."
    & $python.Command @($python.Args + @("-m", "venv", ".venv"))
    if ($LASTEXITCODE -ne 0) {
        throw "Failed to create the virtual environment."
    }
} else {
    Write-Host "Using existing .venv."
}

$venvPython = Join-Path $PSScriptRoot ".venv\Scripts\python.exe"

Write-Host "Upgrading pip tooling..."
& $venvPython -m pip install --upgrade pip wheel setuptools
if ($LASTEXITCODE -ne 0) {
    throw "Failed to upgrade pip tooling."
}

Write-Host "Installing base dependencies..."
& $venvPython -m pip install -r requirements.txt
if ($LASTEXITCODE -ne 0) {
    throw "Failed to install base dependencies."
}

Write-Host ""
Write-Host "Install complete."
Write-Host "Run start_windows.bat, then open http://127.0.0.1:8000"
