[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$Version,
    [ValidateSet("stable", "beta")]
    [string]$Channel = "stable",
    [string]$Publisher = "CN=BoxingCoach Development",
    [string]$PackageBaseUri = "https://example.invalid/boxingcoach",
    [string]$SupabaseUrl = "",
    [string]$SupabasePublishableKey = "",
    [string]$AuthEmailDomain = "accounts.boxingcoach.app",
    [ValidateSet("local", "hosted")]
    [string]$UiMode = "local",
    [string]$HostedAppUrl = "",
    [switch]$DisableBundledFallback,
    [string]$CertificatePath = "",
    [string]$TimestampUrl = "",
    [switch]$ForceUpdate,
    [switch]$LayoutOnly,
    [switch]$NoRestore
)

$ErrorActionPreference = "Stop"
$windowsRoot = $PSScriptRoot
$projectRoot = Split-Path $windowsRoot -Parent
$repositoryRoot = Split-Path $projectRoot -Parent

function Resolve-PackageVersion {
    param([string]$Value)
    $parts = $Value.Split('.')
    if ($parts.Count -eq 3) { $parts += "0" }
    $invalidParts = @($parts | Where-Object { $_ -notmatch '^\d+$' })
    if ($parts.Count -ne 4 -or $invalidParts.Count -gt 0) {
        throw "Version must contain three or four numeric parts, for example 1.2.3 or 1.2.3.0."
    }
    return ($parts -join '.')
}

function Assert-ChildPath {
    param([string]$Path, [string]$Parent)
    $resolvedPath = [IO.Path]::GetFullPath($Path)
    $resolvedParent = [IO.Path]::GetFullPath($Parent).TrimEnd('\') + '\'
    if (!$resolvedPath.StartsWith($resolvedParent, [StringComparison]::OrdinalIgnoreCase)) {
        throw "Refusing to modify a path outside the project: $resolvedPath"
    }
    return $resolvedPath
}

function Reset-Directory {
    param([string]$Path)
    $safePath = Assert-ChildPath -Path $Path -Parent $projectRoot
    if (Test-Path -LiteralPath $safePath) {
        Remove-Item -LiteralPath $safePath -Recurse -Force
    }
    New-Item -ItemType Directory -Path $safePath -Force | Out-Null
    return $safePath
}

function Find-DotNet {
    $candidates = @(
        $env:BOXING_COACH_DOTNET,
        (Join-Path $repositoryRoot ".tools\dotnet\dotnet.exe"),
        "dotnet"
    ) | Where-Object { $_ }
    foreach ($candidate in $candidates) {
        if ($candidate -eq "dotnet" -or (Test-Path -LiteralPath $candidate)) { return $candidate }
    }
    throw ".NET 8 SDK was not found. Set BOXING_COACH_DOTNET or install the .NET 8 SDK."
}

function Find-WindowsSdkTool {
    param([string]$Name)
    $command = Get-Command $Name -ErrorAction SilentlyContinue
    if ($command) { return $command.Source }
    $localSdkRoot = Join-Path $repositoryRoot ".tools\windows-sdk-build-tools"
    if (Test-Path -LiteralPath $localSdkRoot) {
        $localTool = Get-ChildItem -LiteralPath $localSdkRoot -Recurse -Filter $Name -ErrorAction SilentlyContinue |
            Where-Object { $_.FullName -match '\\x64\\' } |
            Sort-Object FullName -Descending |
            Select-Object -First 1
        if ($localTool) { return $localTool.FullName }
    }
    $sdkRoot = "C:\Program Files (x86)\Windows Kits\10\bin"
    if (Test-Path $sdkRoot) {
        $tool = Get-ChildItem $sdkRoot -Recurse -Filter $Name -ErrorAction SilentlyContinue |
            Where-Object { $_.FullName -match '\\x64\\' } |
            Sort-Object FullName -Descending |
            Select-Object -First 1
        if ($tool) { return $tool.FullName }
    }
    throw "$Name was not found. Install the Windows 10/11 SDK build tools."
}

function Escape-Xml {
    param([string]$Value)
    return [Security.SecurityElement]::Escape($Value)
}

function New-PackageAsset {
    param([int]$Width, [int]$Height, [string]$Path)
    Add-Type -AssemblyName System.Drawing
    $bitmap = New-Object Drawing.Bitmap($Width, $Height)
    $graphics = [Drawing.Graphics]::FromImage($bitmap)
    try {
        $graphics.SmoothingMode = [Drawing.Drawing2D.SmoothingMode]::AntiAlias
        $graphics.Clear([Drawing.Color]::FromArgb(5, 10, 16))
        $penWidth = [Math]::Max(3, [Math]::Floor([Math]::Min($Width, $Height) / 28))
        $pen = New-Object Drawing.Pen([Drawing.Color]::FromArgb(46, 232, 255), $penWidth)
        $margin = [Math]::Max(6, [Math]::Floor([Math]::Min($Width, $Height) * 0.16))
        $diameter = [Math]::Min($Width, $Height) - ($margin * 2)
        $x = [Math]::Floor(($Width - $diameter) / 2)
        $y = [Math]::Floor(($Height - $diameter) / 2)
        $graphics.DrawEllipse($pen, $x, $y, $diameter, $diameter)
        $fontSize = [Math]::Max(12, [Math]::Floor($diameter * 0.48))
        $font = New-Object Drawing.Font("Segoe UI", $fontSize, [Drawing.FontStyle]::Bold, [Drawing.GraphicsUnit]::Pixel)
        $brush = New-Object Drawing.SolidBrush([Drawing.Color]::White)
        $format = New-Object Drawing.StringFormat
        $format.Alignment = [Drawing.StringAlignment]::Center
        $format.LineAlignment = [Drawing.StringAlignment]::Center
        $graphics.DrawString("A", $font, $brush, (New-Object Drawing.RectangleF(0, 0, $Width, $Height)), $format)
        $bitmap.Save($Path, [Drawing.Imaging.ImageFormat]::Png)
        $format.Dispose(); $brush.Dispose(); $font.Dispose(); $pen.Dispose()
    } finally {
        $graphics.Dispose()
        $bitmap.Dispose()
    }
}

$packageVersion = Resolve-PackageVersion $Version
$packageId = if ($Channel -eq "beta") { "BoxingCoach.Apex.Beta" } else { "BoxingCoach.Apex" }
$displayName = if ($Channel -eq "beta") { "APEX Boxing AI Coach Beta" } else { "APEX Boxing AI Coach" }
if ($UiMode -eq "hosted" -and $HostedAppUrl -notmatch '^https://') {
    throw "HostedAppUrl must be an HTTPS URL for hosted UI packages."
}
if ($UiMode -eq "hosted" -and (!$SupabaseUrl -or !$SupabasePublishableKey)) {
    throw "Hosted UI packages require SupabaseUrl and SupabasePublishableKey."
}
$buildRoot = Reset-Directory (Join-Path $projectRoot "build\windows\$Channel\$packageVersion")
$artifactChannelRoot = Join-Path $projectRoot "artifacts\$Channel"
New-Item -ItemType Directory -Path $artifactChannelRoot -Force | Out-Null
$artifactRoot = Reset-Directory (Join-Path $projectRoot "artifacts\$Channel\$packageVersion")
$desktopPublish = Join-Path $buildRoot "desktop"
$workerDist = Join-Path $buildRoot "worker-dist"
$layout = Join-Path $buildRoot "layout"
$assets = Join-Path $layout "Assets"
New-Item -ItemType Directory -Force $desktopPublish, $workerDist, $layout, $assets | Out-Null

$dotnet = Find-DotNet
$env:DOTNET_CLI_HOME = Join-Path $repositoryRoot ".tools\dotnet-home"
$env:NUGET_PACKAGES = Join-Path $repositoryRoot ".tools\nuget-packages"
$env:DOTNET_CLI_TELEMETRY_OPTOUT = "1"
$desktopProject = Join-Path $windowsRoot "BoxingCoach.Desktop\BoxingCoach.Desktop.csproj"
if (!$NoRestore) {
    & $dotnet restore $desktopProject --runtime win-x64 --configfile (Join-Path $projectRoot "NuGet.Config")
    if ($LASTEXITCODE -ne 0) { throw "Desktop restore failed." }
}
$publishArguments = @(
    "publish", $desktopProject,
    "--configuration", "Release",
    "--runtime", "win-x64",
    "--self-contained", "true",
    "--output", $desktopPublish,
    "--no-restore",
    "-p:Version=$packageVersion",
    "-p:AssemblyVersion=$packageVersion",
    "-p:FileVersion=$packageVersion"
)
& $dotnet @publishArguments
if ($LASTEXITCODE -ne 0) { throw "Desktop publish failed." }

$python = Join-Path $projectRoot ".venv\Scripts\python.exe"
if (!(Test-Path $python)) { throw "Python build environment was not found at $python" }
& $python -m PyInstaller --noconfirm --clean --log-level WARN (Join-Path $projectRoot "BoxingCoach.Worker.spec") --distpath $workerDist --workpath (Join-Path $buildRoot "pyinstaller")
if ($LASTEXITCODE -ne 0) { throw "Python worker build failed." }

Copy-Item (Join-Path $desktopPublish "*") $layout -Recurse -Force
$workerLayout = Join-Path $layout "worker"
New-Item -ItemType Directory -Force $workerLayout | Out-Null
Copy-Item (Join-Path $workerDist "BoxingCoach.Worker.exe") $workerLayout -Force

$settings = [ordered]@{
    DataMode = if ($SupabaseUrl -and $SupabasePublishableKey) { "supabase" } else { "local" }
    SupabaseUrl = $SupabaseUrl
    SupabasePublishableKey = $SupabasePublishableKey
    AuthEmailDomain = $AuthEmailDomain
    UiMode = $UiMode
    HostedAppUrl = $HostedAppUrl
    AllowBundledFallback = !$DisableBundledFallback.IsPresent
}
$settings | ConvertTo-Json | Set-Content -Encoding UTF8 (Join-Path $layout "appsettings.json")

New-PackageAsset 44 44 (Join-Path $assets "Square44x44Logo.png")
New-PackageAsset 150 150 (Join-Path $assets "Square150x150Logo.png")
New-PackageAsset 50 50 (Join-Path $assets "StoreLogo.png")
New-PackageAsset 310 150 (Join-Path $assets "Wide310x150Logo.png")
New-PackageAsset 620 300 (Join-Path $assets "SplashScreen.png")

$manifest = Get-Content -Raw -Encoding UTF8 (Join-Path $windowsRoot "packaging\AppxManifest.template.xml")
$manifest = $manifest.Replace("@@PACKAGE_ID@@", (Escape-Xml $packageId))
$manifest = $manifest.Replace("@@PUBLISHER@@", (Escape-Xml $Publisher))
$manifest = $manifest.Replace("@@VERSION@@", $packageVersion)
$manifest = $manifest.Replace("@@DISPLAY_NAME@@", (Escape-Xml $displayName))
$manifest | Set-Content -Encoding UTF8 (Join-Path $layout "AppxManifest.xml")

$msixName = "$packageId-$packageVersion-x64.msix"
$msixPath = Join-Path $artifactRoot $msixName
if (!$LayoutOnly) {
    $makeAppx = Find-WindowsSdkTool "makeappx.exe"
    & $makeAppx pack /o /d $layout /p $msixPath
    if ($LASTEXITCODE -ne 0) { throw "MSIX packaging failed." }

    if ($CertificatePath) {
        if (!(Test-Path $CertificatePath)) { throw "Certificate not found: $CertificatePath" }
        $signTool = Find-WindowsSdkTool "signtool.exe"
        $signArguments = @("sign", "/fd", "SHA256", "/f", $CertificatePath)
        if ($env:BOXING_COACH_CERT_PASSWORD) { $signArguments += @("/p", $env:BOXING_COACH_CERT_PASSWORD) }
        if ($TimestampUrl) { $signArguments += @("/tr", $TimestampUrl, "/td", "SHA256") }
        $signArguments += $msixPath
        & $signTool @signArguments
        if ($LASTEXITCODE -ne 0) { throw "MSIX signing failed." }
    } else {
        Write-Warning "The MSIX is unsigned and cannot be installed on customer devices. Provide -CertificatePath for a distributable package."
    }
}

$baseUri = $PackageBaseUri.TrimEnd('/') + "/" + $Channel
$appInstallerName = "BoxingCoach-$Channel.appinstaller"
$appInstaller = Get-Content -Raw -Encoding UTF8 (Join-Path $windowsRoot "packaging\BoxingCoach.appinstaller.template.xml")
$appInstaller = $appInstaller.Replace("@@APPINSTALLER_URI@@", (Escape-Xml "$baseUri/$appInstallerName"))
$appInstaller = $appInstaller.Replace("@@PACKAGE_URI@@", (Escape-Xml "$baseUri/$packageVersion/$msixName"))
$appInstaller = $appInstaller.Replace("@@PACKAGE_ID@@", (Escape-Xml $packageId))
$appInstaller = $appInstaller.Replace("@@PUBLISHER@@", (Escape-Xml $Publisher))
$appInstaller = $appInstaller.Replace("@@VERSION@@", $packageVersion)
$appInstaller = $appInstaller.Replace("@@BLOCKS_ACTIVATION@@", $ForceUpdate.IsPresent.ToString().ToLowerInvariant())
$appInstaller | Set-Content -Encoding UTF8 (Join-Path $artifactChannelRoot $appInstallerName)

$metadata = [ordered]@{
    version = $packageVersion
    channel = $Channel
    package_id = $packageId
    publisher = $Publisher
    signed = [bool]$CertificatePath
    layout_only = $LayoutOnly.IsPresent
    central_accounts = [bool]($SupabaseUrl -and $SupabasePublishableKey)
    ui_mode = $UiMode
    hosted_app_url = $HostedAppUrl
    bundled_fallback = !$DisableBundledFallback.IsPresent
    appinstaller_uri = "$baseUri/$appInstallerName"
    package_uri = "$baseUri/$packageVersion/$msixName"
}
$metadata | ConvertTo-Json | Set-Content -Encoding UTF8 (Join-Path $artifactRoot "release.json")
Write-Host "Release artifacts: $artifactRoot"
