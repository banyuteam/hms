<#
.SYNOPSIS
  Builds an UNSIGNED development MSI of HMS Desktop (ADR-DSK-003). Not for clinical workstations.
.DESCRIPTION
  Release build from Cargo.lock, then WiX. Output: target\msi\hms-desktop-<version>-dev-x64.msi and .sha256.
  Signed release builds come only from the release pipeline (ADR-DSK-003 §4, §8; owner decisions D1-D4 open).
#>
param(
  # Publisher shown in Add/Remove Programs. The real name is owner decision D1.
  [string] $Manufacturer = 'HMS (development build)',
  # Accept the WiX 7 OSMF EULA for this invocation only (nothing saved). The organisation accepted it on 2026-11-09
  # (ADR-DSK-003 D4); omit the switch on machines where `wix eula accept wix7` has been run.
  [switch] $AcceptWixEula
)
# Native tools are checked through $LASTEXITCODE: Windows PowerShell 5.1 would turn their stderr progress output into
# terminating errors under $ErrorActionPreference = 'Stop'.
$root = (Resolve-Path (Join-Path $PSScriptRoot '..\..') -ErrorAction Stop).Path
Push-Location $root
try {
  $meta = cargo metadata --no-deps --format-version 1 --locked | ConvertFrom-Json
  if ($LASTEXITCODE) { throw 'cargo metadata failed' }
  $version = ($meta.packages | Where-Object name -eq 'hms-desktop').version
  # MSI ProductVersion: major.minor.patch, major/minor <= 255, patch <= 65535; no pre-release suffix.
  if ($version -notmatch '^(\d+)\.(\d+)\.(\d+)$' -or [int]$Matches[1] -gt 255 -or [int]$Matches[2] -gt 255 -or [int]$Matches[3] -gt 65535) {
    throw "Cargo version '$version' cannot be an MSI ProductVersion"
  }

  cargo build --release --locked
  if ($LASTEXITCODE) { throw 'cargo build failed' }

  $out = Join-Path $root 'target\msi'
  New-Item -ItemType Directory -Force -Path $out -ErrorAction Stop | Out-Null
  $msi = Join-Path $out "hms-desktop-$version-dev-x64.msi"
  $eula = if ($AcceptWixEula) { @('--acceptEula', 'wix7') } else { @() }
  wix build @eula (Join-Path $PSScriptRoot 'hms-desktop.wxs') -arch x64 `
    -d "Version=$version" -d "Manufacturer=$Manufacturer" -d 'BuildKind=dev, unsigned' `
    -d "ExePath=$(Join-Path $root 'target\release\hms-desktop.exe')" `
    -o $msi
  if ($LASTEXITCODE) { throw 'wix build failed' }

  $hash = (Get-FileHash -Algorithm SHA256 -Path $msi -ErrorAction Stop).Hash.ToLowerInvariant()
  Set-Content -Path "$msi.sha256" -Value "$hash  $(Split-Path $msi -Leaf)" -Encoding ascii -ErrorAction Stop
  "built $msi"
  "sha256 $hash"
}
finally {
  Pop-Location
}
