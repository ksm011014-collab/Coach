[CmdletBinding()]
param(
    [string]$Publisher = "CN=BoxingCoach Development",
    [string]$OutputDirectory = "",
    [string]$Password = ""
)

$ErrorActionPreference = "Stop"
if (!$OutputDirectory) { $OutputDirectory = Join-Path $PSScriptRoot "..\artifacts\development-certificate" }
$OutputDirectory = [IO.Path]::GetFullPath($OutputDirectory)
New-Item -ItemType Directory -Force $OutputDirectory | Out-Null
if (!$Password) { $Password = $env:BOXING_COACH_CERT_PASSWORD }
if (!$Password) { throw "Provide -Password or BOXING_COACH_CERT_PASSWORD." }

$certificate = New-SelfSignedCertificate `
    -Type Custom `
    -Subject $Publisher `
    -KeyUsage DigitalSignature `
    -FriendlyName "BoxingCoach MSIX Development" `
    -CertStoreLocation "Cert:\CurrentUser\My" `
    -TextExtension @("2.5.29.37={text}1.3.6.1.5.5.7.3.3", "2.5.29.19={text}")
$securePassword = ConvertTo-SecureString $Password -AsPlainText -Force
$pfxPath = Join-Path $OutputDirectory "BoxingCoach-Development.pfx"
$cerPath = Join-Path $OutputDirectory "BoxingCoach-Development.cer"
Export-PfxCertificate -Cert $certificate -FilePath $pfxPath -Password $securePassword | Out-Null
Export-Certificate -Cert $certificate -FilePath $cerPath | Out-Null
Write-Host "Development PFX: $pfxPath"
Write-Host "Public certificate: $cerPath"
Write-Host "Install the CER in Trusted People only on test devices. Never distribute the PFX."
