<#
.SYNOPSIS
  Runs the database tests in tests/sql against a migrated development or CI database.

.DESCRIPTION
  Connects as a superuser (tests switch to each HMS role with SET ROLE to prove what it can and cannot do).
  Every test file runs inside a transaction that is rolled back, so no test data remains.
  Never run against production.

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File scripts\test.ps1 -Database hms
#>
param(
    [string]$DbHost = $(if ($env:PGHOST) { $env:PGHOST } else { '127.0.0.1' }),
    [int]$Port = $(if ($env:PGPORT) { [int]$env:PGPORT } else { 5432 }),
    [string]$Database = 'hms',
    [string]$RolePrefix = 'hms_meta',
    [string]$SuperUser = 'postgres',
    [string]$Psql = ''
)
. (Join-Path $PSScriptRoot '_common.ps1')

$psqlExe = Find-Psql $Psql

$files = @(Get-ChildItem -Path (Join-Path $HmsRoot 'tests/sql') -Filter '*.sql' -File | Sort-Object Name)
$plan = New-Object System.Text.StringBuilder
[void]$plan.AppendLine('\set ON_ERROR_STOP on')
[void]$plan.AppendLine("\set role_prefix '$RolePrefix'")
foreach ($f in $files) {
    [void]$plan.AppendLine("\echo '== $($f.BaseName)'")
    [void]$plan.AppendLine("\i '$(ConvertTo-PsqlPath $f.FullName)'")
}
[void]$plan.AppendLine("\echo 'All $($files.Count) test files passed.'")

$planFile = [System.IO.Path]::Combine([System.IO.Path]::GetTempPath(), "hms_test_$([guid]::NewGuid().ToString('N')).psql")
Write-Utf8NoBom $planFile $plan.ToString()
try {
    Write-Host "Testing database '$Database' on ${DbHost}:$Port as '$SuperUser' (role prefix '$RolePrefix')."
    Invoke-Psql $psqlExe @('-X', '-q', '-h', $DbHost, '-p', "$Port", '-U', $SuperUser, '-d', $Database, '-f', (ConvertTo-PsqlPath $planFile))
} finally {
    Remove-Item -LiteralPath $planFile -Force -ErrorAction SilentlyContinue
}
