# Shared helpers for the hms_database PowerShell scripts (Windows PowerShell 5.1 compatible).
Set-StrictMode -Version 3.0
$ErrorActionPreference = 'Stop'

$script:HmsRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path

function Find-Psql([string]$Explicit) {
    if ($Explicit) { return $Explicit }
    $cmd = Get-Command psql -ErrorAction SilentlyContinue
    if ($cmd) { return $cmd.Source }
    $default = 'C:\Program Files\PostgreSQL\18\bin\psql.exe'
    if (Test-Path $default) { return $default }
    throw 'psql not found: add the PostgreSQL 18 bin directory to PATH or pass -Psql <path>'
}

# Forward slashes and no single quotes, so the path can be embedded in a psql \i '...' command.
function ConvertTo-PsqlPath([string]$Path) {
    $p = (Resolve-Path $Path).Path -replace '\\', '/'
    if ($p.Contains("'")) { throw "path contains a single quote: $p" }
    return $p
}

# SHA-256 of the file with CR bytes removed, so checkouts with CRLF and LF line endings give the same checksum.
function Get-MigrationChecksum([string]$Path) {
    $bytes = [System.IO.File]::ReadAllBytes($Path)
    $normalized = New-Object System.Collections.Generic.List[byte] ($bytes.Length)
    foreach ($b in $bytes) { if ($b -ne 13) { $normalized.Add($b) } }
    $sha = [System.Security.Cryptography.SHA256]::Create()
    try { $hash = $sha.ComputeHash($normalized.ToArray()) } finally { $sha.Dispose() }
    return (($hash | ForEach-Object { $_.ToString('x2') }) -join '')
}

function Write-Utf8NoBom([string]$Path, [string]$Text) {
    [System.IO.File]::WriteAllText($Path, $Text, (New-Object System.Text.UTF8Encoding $false))
}

function Invoke-Psql([string]$Psql, [string[]]$Arguments) {
    $env:PGCLIENTENCODING = 'UTF8'
    & $Psql @Arguments
    if ($LASTEXITCODE -ne 0) { throw "psql failed with exit code $LASTEXITCODE" }
}
