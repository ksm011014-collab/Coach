param(
    [ValidateSet('setup', 'test', 'serve')][string]$Action = 'serve',
    [string]$Python = '',
    [int]$Port = 8000
)
$ErrorActionPreference = 'Stop'
$projectDirectory = Split-Path $PSScriptRoot -Parent
$venvPython = Join-Path $projectDirectory '.venv\Scripts\python.exe'
function Invoke-Checked {
    param([string]$Executable, [string[]]$Arguments)
    & $Executable @Arguments
    if ($LASTEXITCODE -ne 0) { throw "$Executable failed (exit $LASTEXITCODE)." }
}
Push-Location $projectDirectory
try {
    $env:PYTHONDONTWRITEBYTECODE = '1'
    if ($Action -eq 'setup') {
        if (-not (Test-Path -LiteralPath $venvPython)) {
            if ($Python) { Invoke-Checked $Python @('-m', 'venv', '.venv') }
            elseif (Get-Command py -ErrorAction SilentlyContinue) { Invoke-Checked 'py' @('-3', '-m', 'venv', '.venv') }
            elseif (Get-Command python -ErrorAction SilentlyContinue) { Invoke-Checked 'python' @('-m', 'venv', '.venv') }
            else { throw 'Install Python 3.12+ or provide -Python path.' }
        }
        Invoke-Checked $venvPython @('-m', 'pip', 'install', '-r', 'requirements.txt')
        $npm = (Get-Command npm.cmd -ErrorAction Stop).Source
        Invoke-Checked $npm @('install', '--ignore-scripts', '--no-audit', '--no-fund')
        Invoke-Checked $npm @('--prefix', 'tests/rls', 'install', '--ignore-scripts', '--no-audit', '--no-fund')
        Write-Host 'Setup complete. Chrome is required for browser tests.'
    } else {
        if (-not (Test-Path -LiteralPath $venvPython)) { throw 'Run dev.ps1 -Action setup first.' }
        $env:BOXING_COACH_PYTHON = $venvPython
        $env:NODE_PATH = Join-Path $projectDirectory 'node_modules'
        if ($Action -eq 'serve') {
            $env:BOXING_COACH_DATA_MODE = 'local'
            $env:BOXING_COACH_DB_PATH = Join-Path $projectDirectory 'artifacts\development.db'
            $env:BOXING_COACH_HOST = '127.0.0.1'
            $env:BOXING_COACH_PORT = [string]$Port
            $env:BOXING_COACH_OPEN_BROWSER = '0'
            New-Item -ItemType Directory -Path (Join-Path $projectDirectory 'artifacts') -Force | Out-Null
            Invoke-Checked $venvPython @('-B', '-u', 'backend/server.py')
        } else {
            Invoke-Checked $venvPython @('-B', '-m', 'unittest', 'discover', '-s', 'tests')
            foreach ($testFile in @('test_operations_service.js', 'test_auth_session.js', 'test_android_offline.js', 'test_desktop_contract.js', 'test_operations_browser.js', 'test_operations_live_browser.js', 'test_session_browser.js')) {
                Invoke-Checked 'node' @("tests/$testFile")
            }
            Invoke-Checked 'node' @('tests/rls/test_policies.mjs')
        }
    }
} finally { Pop-Location }
