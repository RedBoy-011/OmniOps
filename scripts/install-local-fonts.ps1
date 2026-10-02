param(
  [Parameter(Mandatory = $true)][string]$FontDirectory,
  [string]$Repository
)
$ErrorActionPreference = 'Stop'
if (-not $Repository) { $Repository = Join-Path $PSScriptRoot '..' }
$source = (Resolve-Path -LiteralPath $FontDirectory).Path
$repo = (Resolve-Path -LiteralPath $Repository).Path
$fontNames = @('iransharp_regular_web.woff2', 'iransharp_light_web.woff2', 'iransharp_bold_web.woff2')
$fontDir = Join-Path $source 'WebFonts/fonts/woff2'
foreach ($name in $fontNames) {
  if (-not (Test-Path -LiteralPath (Join-Path $fontDir $name))) { throw "Missing font: $name" }
}
$license = Join-Path $source 'FontLicense.txt'
if (-not (Test-Path -LiteralPath $license)) { throw 'Missing FontLicense.txt' }
foreach ($app in @('web/app', 'agent/windows-edge')) {
  $destination = Join-Path $repo "$app/public/fonts/omniops-iransharp"
  New-Item -ItemType Directory -Force -Path $destination | Out-Null
  foreach ($name in $fontNames) {
    Copy-Item -LiteralPath (Join-Path $fontDir $name) -Destination $destination -Force
  }
  Copy-Item -LiteralPath $license -Destination $destination -Force
  Write-Host "Installed local font assets in $app"
}
Write-Host 'These proprietary font files are gitignored. Confirm your license before distributing builds or serving fonts to other users.'
