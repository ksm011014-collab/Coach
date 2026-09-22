param([switch]$NoBrowser, [switch]$CheckOnly)
$ErrorActionPreference = 'Stop'
$projectDirectory = Split-Path $PSScriptRoot -Parent
$pythonPath = Join-Path $projectDirectory '.venv\Scripts\python.exe'
$settingsPath = Join-Path $projectDirectory '.env.staging.local'
$appUrl = 'http://127.0.0.1:8000'

function Test-AppReady {
    try {
        $health = Invoke-RestMethod "$appUrl/api/system/health" -TimeoutSec 2
        if ($health.status -ne 'ok' -or $health.service -ne 'boxing-coach-local' -or $health.capabilities.data_mode -ne 'supabase') {
            throw 'Port 8000 is not a Supabase-mode BoxingCoach server. Stop the previous local server first.'
        }
        return $true
    } catch [System.Net.WebException] { return $false }
}

try {
    if (-not (Test-Path -LiteralPath $pythonPath)) { throw 'Project Python is missing. Run tools/dev.ps1 -Action setup first.' }
    if (-not (Test-Path -LiteralPath $settingsPath -PathType Leaf)) { throw 'Supabase settings file .env.staging.local is missing.' }
    $settings = @{}
    $allowedKeys = @('BOXING_COACH_DATA_MODE','BOXING_COACH_SUPABASE_URL','BOXING_COACH_SUPABASE_PUBLISHABLE_KEY','BOXING_COACH_AUTH_EMAIL_DOMAIN')
    foreach ($line in Get-Content -LiteralPath $settingsPath -Encoding UTF8) {
        if ($line -match '^\s*([A-Z_]+)\s*=(.*)$' -and $allowedKeys -contains $Matches[1]) {
            $settings[$Matches[1]] = $Matches[2].Trim().Trim('"').Trim("'")
        }
    }
    foreach ($key in $allowedKeys) { if (-not $settings[$key]) { throw "Missing Supabase setting: $key" } }
    if ($settings['BOXING_COACH_DATA_MODE'] -ne 'supabase') { throw 'Settings must select supabase mode. Local database fallback is disabled.' }
    $serviceUri = [uri]$settings['BOXING_COACH_SUPABASE_URL']
    if ($serviceUri.Scheme -ne 'https' -or -not $serviceUri.Host.EndsWith('.supabase.co')) { throw 'Invalid Supabase project URL.' }
    if ($CheckOnly) {
        Write-Output 'Database mode: supabase (.env.staging.local)'
        Write-Output "Python: $pythonPath"
        exit 0
    }
    if (-not (Test-AppReady)) {
        if (Get-NetTCPConnection -LocalPort 8000 -State Listen -ErrorAction SilentlyContinue) { throw 'Port 8000 is already in use. No server was stopped or replaced.' }
        foreach ($key in $allowedKeys) { [Environment]::SetEnvironmentVariable($key,$settings[$key],'Process') }
        $env:BOXING_COACH_DB_PATH = $null
        $env:SUPABASE_ACCESS_TOKEN = $null
        $env:BOXING_COACH_HOST = '127.0.0.1'
        $env:BOXING_COACH_PORT = '8000'
        $env:BOXING_COACH_OPEN_BROWSER = '0'
        $logPrefix = Join-Path $projectDirectory ('artifacts\launcher-' + (Get-Date -Format 'yyyyMMdd-HHmmss-fff'))
        $serverProcess = Start-Process -FilePath $pythonPath -ArgumentList '-B','-u','backend/server.py' -WorkingDirectory $projectDirectory -WindowStyle Hidden -RedirectStandardOutput "$logPrefix.stdout.log" -RedirectStandardError "$logPrefix.stderr.log" -PassThru
        $ready = $false
        for ($attempt = 0; $attempt -lt 30; $attempt++) {
            if (Test-AppReady) { $ready = $true; break }
            if ($serverProcess.HasExited) { throw "Server stopped. Check $logPrefix.stderr.log" }
            Start-Sleep -Milliseconds 500
        }
        if (-not $ready) { throw "Server readiness timed out. Check $logPrefix.stderr.log" }
        Write-Output 'BoxingCoach started in Supabase mode.'
    } else { Write-Output 'BoxingCoach is already running in Supabase mode; reusing the server.' }
    if (-not $NoBrowser) { Start-Process $appUrl }
    Write-Output $appUrl
} catch {
    Write-Host $_.Exception.Message -ForegroundColor Red
    exit 1
}
