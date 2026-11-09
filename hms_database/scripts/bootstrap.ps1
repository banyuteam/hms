<#
.SYNOPSIS
  Creates the HMS database, its roles and baseline privileges (bootstrap/bootstrap.psql). Run once per database.

.DESCRIPTION
  Connects as a PostgreSQL superuser. psql prompts for the superuser password, then for the passwords of the new
  migrator and runtime roles (psql \password: hashed before it is sent). Nothing is stored by this script.
  Safe to run again: creates only what is missing and drops nothing.

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File scripts\bootstrap.ps1 -Database hms
#>
param(
    [string]$DbHost = $(if ($env:PGHOST) { $env:PGHOST } else { '127.0.0.1' }),
    [int]$Port = $(if ($env:PGPORT) { [int]$env:PGPORT } else { 5432 }),
    [string]$SuperUser = 'superman',
    [string]$MaintenanceDatabase = 'postgres',
    [string]$Database = 'hms',
    [string]$RolePrefix = 'hms_meta',
    [string]$Psql = ''
)
. (Join-Path $PSScriptRoot '_common.ps1')

$psqlExe = Find-Psql $Psql
$psqlArgs = @('-X', '-h', $DbHost, '-p', "$Port", '-U', $SuperUser, '-d', $MaintenanceDatabase,
              '-v', 'ON_ERROR_STOP=1', '-v', "dbname=$Database")
$psqlArgs += @('-v', "role_prefix=$RolePrefix")
$psqlArgs += @('-f', (ConvertTo-PsqlPath (Join-Path $HmsRoot 'bootstrap/bootstrap.psql')))

Write-Host "Bootstrapping database '$Database' on ${DbHost}:$Port as superuser '$SuperUser'."
Invoke-Psql $psqlExe $psqlArgs
