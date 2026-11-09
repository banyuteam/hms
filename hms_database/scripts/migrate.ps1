<#
.SYNOPSIS
  Applies pending migrations from migrations/ in one psql session (ADR-DB-001).

.DESCRIPTION
  Validates file names, checksums of already applied migrations and ordering, then applies each pending migration
  in its own transaction as the database owner role. -Plan reports without changing anything.
  Connects as <RolePrefix>_migrator (hms_meta_migrator) by default; psql prompts for its password unless
  PGPASSWORD/pgpass supplies it.

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File scripts\migrate.ps1 -Database hms -Plan
  powershell -ExecutionPolicy Bypass -File scripts\migrate.ps1 -Database hms
#>
param(
    [string]$DbHost = $(if ($env:PGHOST) { $env:PGHOST } else { '127.0.0.1' }),
    [int]$Port = $(if ($env:PGPORT) { [int]$env:PGPORT } else { 5432 }),
    [string]$Database = 'hms',
    [string]$RolePrefix = 'hms_meta',
    [string]$User = '',
    [switch]$Plan,
    [string]$Psql = ''
)
. (Join-Path $PSScriptRoot '_common.ps1')

if (-not $User) { $User = "${RolePrefix}_migrator" }
$psqlExe = Find-Psql $Psql
$tooling = ConvertTo-PsqlPath (Join-Path $HmsRoot 'tooling/psql')

$files = @(Get-ChildItem -Path (Join-Path $HmsRoot 'migrations') -Filter '*.sql' -File | Sort-Object Name)
$seen = @{}
$steps = New-Object System.Text.StringBuilder
foreach ($f in $files) {
    if ($f.Name -notmatch '^(\d{4})_([a-z0-9_]+)\.sql$') { throw "invalid migration file name: $($f.Name) (expected NNNN_snake_case.sql)" }
    $version = $Matches[1]; $name = $Matches[2]
    if ($seen.ContainsKey($version)) { throw "duplicate migration version $version" }
    $seen[$version] = $true
    $bytes = [System.IO.File]::ReadAllBytes($f.FullName)
    if ($bytes.Length -ge 3 -and $bytes[0] -eq 0xEF -and $bytes[1] -eq 0xBB -and $bytes[2] -eq 0xBF) { throw "$($f.Name) has a UTF-8 BOM" }
    $text = [System.Text.Encoding]::UTF8.GetString($bytes)
    if ($text -match '(?im)^\s*(BEGIN|COMMIT|ROLLBACK|START\s+TRANSACTION)\s*;') {
        throw "$($f.Name) contains transaction control; the runner wraps each migration in its own transaction"
    }
    [void]$steps.AppendLine("\set m_version '$version'")
    [void]$steps.AppendLine("\set m_name '$name'")
    [void]$steps.AppendLine("\set m_checksum '$(Get-MigrationChecksum $f.FullName)'")
    [void]$steps.AppendLine("\set m_file '$(ConvertTo-PsqlPath $f.FullName)'")
    [void]$steps.AppendLine("\i '$tooling/apply_one.psql'")
}

$planText = "\set ON_ERROR_STOP on`n" +
            "\set hms_plan $(if ($Plan) { 'true' } else { 'false' })`n" +
            "\set hms_all_versions '$(($seen.Keys | Sort-Object) -join ',')'`n" +
            "\i '$tooling/migrate_begin.psql'`n" +
            $steps.ToString() +
            "\i '$tooling/migrate_end.psql'`n"

$planFile = [System.IO.Path]::Combine([System.IO.Path]::GetTempPath(), "hms_migrate_$([guid]::NewGuid().ToString('N')).psql")
Write-Utf8NoBom $planFile $planText
try {
    Write-Host "$(if ($Plan) { 'Planning' } else { 'Migrating' }) database '$Database' on ${DbHost}:$Port as '$User' ($($files.Count) migration files)."
    $env:PGAPPNAME = 'hms_database_migrate'
    Invoke-Psql $psqlExe @('-X', '-q', '-h', $DbHost, '-p', "$Port", '-U', $User, '-d', $Database, '-f', (ConvertTo-PsqlPath $planFile))
} finally {
    Remove-Item -LiteralPath $planFile -Force -ErrorAction SilentlyContinue
}
