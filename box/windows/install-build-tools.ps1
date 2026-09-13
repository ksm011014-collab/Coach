[CmdletBinding()]
param(
    [string]$Version = "10.0.28000.2270"
)

$ErrorActionPreference = "Stop"
if ($Version -notmatch '^\d+\.\d+\.\d+\.\d+$') {
    throw "Windows SDK Build Tools version must contain four numeric parts."
}

$repositoryRoot = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
$toolsRoot = Join-Path $repositoryRoot ".tools\windows-sdk-build-tools"
$installRoot = [IO.Path]::GetFullPath((Join-Path $toolsRoot $Version))
$safeRoot = [IO.Path]::GetFullPath($toolsRoot).TrimEnd('\') + '\'
if (!$installRoot.StartsWith($safeRoot, [StringComparison]::OrdinalIgnoreCase)) {
    throw "Refusing to install outside the project tools directory."
}

$packageRoot = Join-Path $installRoot "package"
$existing = Get-ChildItem -LiteralPath $packageRoot -Recurse -Filter "makeappx.exe" -ErrorAction SilentlyContinue |
    Where-Object { $_.FullName -match '\\x64\\' } |
    Select-Object -First 1
if ($existing) {
    Write-Host "Windows SDK Build Tools already installed: $($existing.FullName)"
    exit 0
}

New-Item -ItemType Directory -Path $installRoot -Force | Out-Null
$normalizedVersion = $Version.ToLowerInvariant()
$packageName = "microsoft.windows.sdk.buildtools.$normalizedVersion.nupkg"
$packageUri = "https://api.nuget.org/v3-flatcontainer/microsoft.windows.sdk.buildtools/$normalizedVersion/$packageName"
$packagePath = Join-Path $installRoot $packageName
$archivePath = Join-Path $installRoot "package.zip"

Invoke-WebRequest -Uri $packageUri -OutFile $packagePath
Copy-Item -LiteralPath $packagePath -Destination $archivePath -Force
Expand-Archive -LiteralPath $archivePath -DestinationPath $packageRoot -Force

$makeAppx = Get-ChildItem -LiteralPath $packageRoot -Recurse -Filter "makeappx.exe" |
    Where-Object { $_.FullName -match '\\x64\\' } |
    Select-Object -First 1
$signTool = Get-ChildItem -LiteralPath $packageRoot -Recurse -Filter "signtool.exe" |
    Where-Object { $_.FullName -match '\\x64\\' } |
    Select-Object -First 1
if (!$makeAppx -or !$signTool) {
    throw "The downloaded package did not contain x64 MakeAppx and SignTool."
}

Write-Host "Windows SDK Build Tools installed: $packageRoot"
