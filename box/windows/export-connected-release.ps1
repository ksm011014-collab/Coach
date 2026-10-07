[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [ValidatePattern('^\d+\.\d+\.\d+\.\d+$')]
    [string]$Version,
    [ValidateSet('stable', 'beta')]
    [string]$Channel = 'stable'
)

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path $PSScriptRoot -Parent
$layout = Join-Path $projectRoot "build\windows\$Channel\$Version\layout"
$settings = Get-Content -LiteralPath (Join-Path $layout 'appsettings.json') -Raw | ConvertFrom-Json
if ($settings.DataMode -ne 'supabase' -or !$settings.SupabaseUrl -or !$settings.SupabasePublishableKey) {
    throw 'Only a Supabase-connected release can be exported.'
}
foreach ($relative in @('BoxingCoach.Desktop.exe', 'worker\BoxingCoach.Worker.exe')) {
    if (!(Test-Path -LiteralPath (Join-Path $layout $relative) -PathType Leaf)) { throw "Missing release file: $relative" }
}
$releaseRoot = Join-Path $projectRoot 'release'
$destination = Join-Path $releaseRoot "BoxingCoach-$Version-$Channel"
$archive = "$destination.zip"
if ((Test-Path -LiteralPath $destination) -or (Test-Path -LiteralPath $archive)) {
    throw 'This release already exists. Choose a new version instead of overwriting it.'
}
New-Item -ItemType Directory -Path $destination -Force | Out-Null
Get-ChildItem -LiteralPath $layout | Copy-Item -Destination $destination -Recurse
@'
JDC — connected Windows release

Run BoxingCoach.Desktop.exe. Keep this entire folder together.
The .NET runtime and local worker are included. Microsoft WebView2 Runtime is required.
Sign in using your central account. Internet access is required for DB and AI chat.
The included appsettings.json uses the existing Supabase service and public client key.
OpenAI and privileged Supabase keys remain on the server.
This portable folder is not a signed installer and has no automatic download/update URL.
Do not run the legacy release/BoxingCoach.exe when verifying this release.
'@ | Set-Content -LiteralPath (Join-Path $destination 'README.txt') -Encoding UTF8
Compress-Archive -LiteralPath $destination -DestinationPath $archive -CompressionLevel Optimal
$shortcutShell = New-Object -ComObject WScript.Shell
$shortcut = $shortcutShell.CreateShortcut((Join-Path $releaseRoot 'JDC.lnk'))
$shortcut.TargetPath = Join-Path $destination 'BoxingCoach.Desktop.exe'
$shortcut.WorkingDirectory = $destination
$shortcut.Description = "JDC $Version ($Channel)"
$shortcut.IconLocation = "$(Join-Path $destination 'BoxingCoach.Desktop.exe'),0"
$shortcut.Save()
Write-Output "Executable: $(Join-Path $destination 'BoxingCoach.Desktop.exe')"
Write-Output "Archive: $archive"
