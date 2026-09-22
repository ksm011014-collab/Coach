param(
    [ValidateSet('setup', 'test', 'serve')][string]$Action = 'serve',
    [string]$Python = '',
    [string]$NodeDirectory = '',
    [int]$Port = 8000
)
$ErrorActionPreference = 'Stop'
$projectDirectory = Split-Path $PSScriptRoot -Parent
$venvPython = Join-Path $projectDirectory '.venv\Scripts\python.exe'
if ($NodeDirectory) { $env:Path = (Resolve-Path -LiteralPath $NodeDirectory).Path + ';' + $env:Path }
function Invoke-Checked {
    param([string]$Executable, [string[]]$Arguments)
    & $Executable @Arguments
    if ($LASTEXITCODE -ne 0) { throw "$Executable failed (exit $LASTEXITCODE)." }
}
Push-Location $projectDirectory
try {
    $env:PYTHONDONTWRITEBYTECODE = '1'
    if ($Action -eq 'setup') {
        if ($Python -and (Test-Path -LiteralPath $venvPython)) { Invoke-Checked $Python @('-m', 'venv', '--upgrade', '.venv') }
        if (-not (Test-Path -LiteralPath $venvPython)) {
            if ($Python) { Invoke-Checked $Python @('-m', 'venv', '.venv') }
            elseif (Get-Command py -ErrorAction SilentlyContinue) { Invoke-Checked 'py' @('-3', '-m', 'venv', '.venv') }
            elseif (Get-Command python -ErrorAction SilentlyContinue) { Invoke-Checked 'python' @('-m', 'venv', '.venv') }
            else { throw 'Install Python 3.12+ or provide -Python path.' }
        }
        Invoke-Checked $venvPython @('-c', 'import sys; assert sys.version_info >= (3, 12), "Python 3.12+ required. Run setup -Python path-to-python312.exe"')
        Invoke-Checked 'node' @('-e', 'if (Number(process.versions.node.split(".")[0]) < 22) process.exit(1)')
        Invoke-Checked $venvPython @('-m', 'pip', 'install', '-r', 'requirements.txt')
        $npm = (Get-Command npm.cmd -ErrorAction Stop).Source
        Invoke-Checked $npm @('install', '--ignore-scripts', '--no-audit', '--no-fund')
        Push-Location tests/rls
        try { Invoke-Checked $npm @('install', '--ignore-scripts', '--no-audit', '--no-fund') }
        finally { Pop-Location }
        Write-Host 'Setup complete. Chrome is required for browser tests.'
    } else {
        if (-not (Test-Path -LiteralPath $venvPython)) { throw 'Run dev.ps1 -Action setup first.' }
        $env:BOXING_COACH_PYTHON = $venvPython
        $env:NODE_PATH = Join-Path $projectDirectory 'node_modules'
        if ($Action -eq 'serve') {
            $env:BOXING_COACH_DATA_MODE = 'local'
            $env:BOXING_COACH_DB_PATH = Join-Path $projectDirectory 'artifacts\development.db'
            $savedDatabasePath = Join-Path $projectDirectory 'artifacts\development-db.txt'
            if (Test-Path -LiteralPath $savedDatabasePath) {
                $databaseName = (Get-Content -LiteralPath $savedDatabasePath -Raw).Trim()
                if ($databaseName -notmatch '^development[-a-zA-Z0-9]*\.db$') { throw 'Invalid saved development database name.' }
                $env:BOXING_COACH_DB_PATH = Join-Path $projectDirectory "artifacts\$databaseName"
                if (-not (Test-Path -LiteralPath $env:BOXING_COACH_DB_PATH)) { throw 'Saved development database is missing; refusing to create an empty replacement.' }
            }
            $env:BOXING_COACH_HOST = '127.0.0.1'
            $env:BOXING_COACH_PORT = [string]$Port
            $env:BOXING_COACH_OPEN_BROWSER = '0'
            New-Item -ItemType Directory -Path (Join-Path $projectDirectory 'artifacts') -Force | Out-Null
            Invoke-Checked $venvPython @('-B', '-u', 'backend/server.py')
        } else {
            Invoke-Checked $venvPython @('-B', '-m', 'unittest', 'discover', '-s', 'tests')
            Invoke-Checked 'node' @('tests/test_session_finish.js')
            foreach ($motionTest in @('test_motion_skeleton.mjs', 'test_motion_pipeline.mjs', 'test_motion_features.mjs', 'test_motion_recognizer.mjs', 'test_motion_round.mjs', 'test_coach_conversation.mjs', 'test_coach_voice.mjs', 'test_round_coach_browser.js')) {
                Invoke-Checked 'node' @("tests/$motionTest")
            }
            foreach ($testFile in @('test_session_media.js', 'test_operations_service.js', 'test_auth_session.js', 'test_android_offline.js', 'test_desktop_contract.js', 'test_operations_browser.js', 'test_operations_states_browser.js', 'test_operations_audit_browser.js', 'test_operations_live_browser.js', 'test_operations_integration_browser.js', 'test_operations_calendar_browser.js', 'test_session_browser.js')) {
                Invoke-Checked 'node' @("tests/$testFile")
            }
            Invoke-Checked 'node' @('tests/rls/test_policies.mjs')
            Invoke-Checked 'node' @('tests/test_registration_edge.mjs')
        }
    }
} finally { Pop-Location }
