param([switch]$NoBrowser, [switch]$CheckOnly, [switch]$Central, [string]$SettingsFile)
$ErrorActionPreference = 'Stop'
$projectDirectory = Split-Path $PSScriptRoot -Parent
$pythonPath = Join-Path $projectDirectory '.venv\Scripts\python.exe'
if (-not (Test-Path -LiteralPath $pythonPath)) {
    $bundledPython = Join-Path $env:USERPROFILE '.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe'
    if (Test-Path -LiteralPath $bundledPython) { $pythonPath = $bundledPython }
}
$settingsPath = if ($SettingsFile) { $SettingsFile } else { Join-Path $projectDirectory '.env.staging.local' }
$port = if ($Central) { 8080 } else { 8000 }
$expectedService = if ($Central) { 'boxing-coach-cloud' } else { 'boxing-coach-local' }
$serverScript = if ($Central) { 'backend/cloud_server.py' } else { 'backend/server.py' }
$appUrl = "http://127.0.0.1:$port"

function Test-AppReady {
    try {
        $health = Invoke-RestMethod "$appUrl/api/system/health" -TimeoutSec 2
        $dataMode = if ($Central) { $health.data_mode } else { $health.capabilities.data_mode }
        if ($health.status -ne 'ok' -or $health.service -ne $expectedService -or $dataMode -ne 'supabase') {
            throw "Port $port is not the requested Supabase-mode BoxingCoach server."
        }
        return $true
    } catch [System.Net.WebException] { return $false }
}

try {
    if (-not (Test-Path -LiteralPath $pythonPath)) { throw 'Project Python is missing. Run tools/dev.ps1 -Action setup first.' }
    $settings = @{}
    $allowedKeys = @('BOXING_COACH_DATA_MODE','BOXING_COACH_SUPABASE_URL','BOXING_COACH_SUPABASE_PUBLISHABLE_KEY','BOXING_COACH_AUTH_EMAIL_DOMAIN')
    foreach ($key in $allowedKeys) {
        $value = [Environment]::GetEnvironmentVariable($key, 'Process')
        if ($value) { $settings[$key] = $value }
    }
    if (Test-Path -LiteralPath $settingsPath -PathType Leaf) {
    foreach ($line in Get-Content -LiteralPath $settingsPath -Encoding UTF8) {
        if ($line -match '^\s*([A-Z_]+)\s*=(.*)$' -and $allowedKeys -contains $Matches[1]) {
            $settings[$Matches[1]] = $Matches[2].Trim().Trim('"').Trim("'")
        }
    }
    }
    if ($Central -and -not $settings['BOXING_COACH_DATA_MODE']) { $settings['BOXING_COACH_DATA_MODE'] = 'supabase' }
    if (-not $settings['BOXING_COACH_AUTH_EMAIL_DOMAIN']) { $settings['BOXING_COACH_AUTH_EMAIL_DOMAIN'] = 'accounts.boxingcoach.app' }
    foreach ($key in $allowedKeys) { if (-not $settings[$key]) { throw "Missing Supabase setting: $key" } }
    if ($settings['BOXING_COACH_DATA_MODE'] -ne 'supabase') { throw 'Settings must select supabase mode. Local database fallback is disabled.' }
    $serviceUri = [uri]$settings['BOXING_COACH_SUPABASE_URL']
    if ($serviceUri.Scheme -ne 'https' -or -not $serviceUri.Host.EndsWith('.supabase.co')) { throw 'Invalid Supabase project URL.' }
    if ($CheckOnly) {
        Write-Output "Database mode: supabase; service: $expectedService"
        Write-Output "Python: $pythonPath"
        exit 0
    }
    if (-not (Test-AppReady)) {
        if (Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue) { throw "Port $port is already in use. No server was stopped or replaced." }
        foreach ($key in $allowedKeys) { [Environment]::SetEnvironmentVariable($key,$settings[$key],'Process') }
        $env:BOXING_COACH_DB_PATH = $null
        $env:SUPABASE_ACCESS_TOKEN = $null
        $env:BOXING_COACH_HOST = '127.0.0.1'
        $env:BOXING_COACH_PORT = [string]$port
        $env:BOXING_COACH_OPEN_BROWSER = '0'
        $logPrefix = Join-Path $projectDirectory ('artifacts\launcher-' + (Get-Date -Format 'yyyyMMdd-HHmmss-fff'))
        New-Item -ItemType Directory -Path (Split-Path $logPrefix -Parent) -Force | Out-Null
        $serverProcess = Start-Process -FilePath $pythonPath -ArgumentList '-B','-u',$serverScript -WorkingDirectory $projectDirectory -WindowStyle Hidden -RedirectStandardOutput "$logPrefix.stdout.log" -RedirectStandardError "$logPrefix.stderr.log" -PassThru
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
