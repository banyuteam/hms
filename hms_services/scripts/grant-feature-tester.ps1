<#
.SYNOPSIS
  Development helper: gives one HMS user a role holding every feature permission, so all features can be tried.

.DESCRIPTION
  Signs in to a running hms-services as an IAM administrator (credentials are prompted; nothing is stored), then
  only uses the IAM administration API (contracts/api/iam-admin-v1.openapi.yaml), so every change is checked by the
  server and written to the audit trail:
    1. creates the role -RoleCode (default feature-tester) with every active permission except iam.*, or brings an
       existing one up to date when new permissions were registered;
    2. grants it organization-wide to -Target, expiring after -Days days (default 7).
  -Revoke instead revokes the target's active assignments of that role.
  Without -Target it lists the users and the Khanza ID each signs in as.

  The administrator cannot grant a role to themselves (403 self_change_not_allowed): the target must be another
  account, which must have signed in to HMS once. To test with the administrator's own account, a second IAM
  administrator has to run this script for them. The target signs out and in again to get the new permissions.
  For development and test servers only; real roles are decided by the owner.

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File scripts\grant-feature-tester.ps1
  powershell -ExecutionPolicy Bypass -File scripts\grant-feature-tester.ps1 -Target 12345
  powershell -ExecutionPolicy Bypass -File scripts\grant-feature-tester.ps1 -Target 12345 -Revoke
#>
param(
    [string]$BaseUrl = 'http://127.0.0.1:8080',
    [string]$Origin = '',
    [string]$EnvFile = (Join-Path $PSScriptRoot '..\.env'),
    [string]$Target = '2025.311',
    [ValidatePattern('^[a-z][a-z0-9_-]{1,63}$')]
    [string]$RoleCode = 'feature-tester',
    [ValidateRange(1, 90)]
    [int]$Days = 7,
    [string]$Reason = 'Development feature testing',
    [switch]$Revoke,
    [pscredential]$Credential
)
$ErrorActionPreference = 'Stop'
$api = $BaseUrl.TrimEnd('/') + '/api/v1'
# Unsafe requests must carry Origin = PUBLIC_ORIGIN; by default it is read from the service's .env (only that line).
if (-not $Origin -and (Test-Path -LiteralPath $EnvFile)) {
    $line = Select-String -LiteralPath $EnvFile -Pattern '^\s*PUBLIC_ORIGIN\s*=\s*(.+?)\s*$' | Select-Object -First 1
    if ($line) { $Origin = $line.Matches[0].Groups[1].Value.Trim('"', "'") }
}
if (-not $Origin) { $Origin = 'http://127.0.0.1:5174' }
# The session cookie is carried by hand: with an https PUBLIC_ORIGIN it is a Secure __Host- cookie, which a cookie
# container would not send to the plain-http service address (and Windows PowerShell drops a Cookie header).
$session = $null

$hints = @{
    invalid_credentials     = 'the Khanza user ID or password is wrong'
    forbidden               = 'the signed-in account is not an IAM administrator'
    origin_not_allowed      = "Origin $Origin is not the server's PUBLIC_ORIGIN; pass -Origin or -EnvFile"
    unauthorized            = 'the session ended; run the script again'
    self_change_not_allowed = 'an administrator cannot change their own roles; use another account as the target'
    conflict                = 'it already exists or is already in force'
}

function Invoke-Hms([string]$Method, [string]$Path, $Body = $null) {
    $request = @{ Method = $Method; Uri = "$api$Path"; Headers = @{ Origin = $Origin }; UseBasicParsing = $true }
    if ($script:session) { $request.WebSession = $script:session }
    if ($null -ne $Body) {
        $request.ContentType = 'application/json; charset=utf-8'
        $request.Body = [System.Text.Encoding]::UTF8.GetBytes(($Body | ConvertTo-Json -Depth 5 -Compress))
    }
    try {
        $response = Invoke-WebRequest @request
        $set = $response.Headers['Set-Cookie']
        if (-not $script:session -and $set -match '(?:^|[\s,])((?:__Host-)?hms_session)=([^;,\s]+)') {
            $script:session = New-Object Microsoft.PowerShell.Commands.WebRequestSession
            $script:session.Cookies.Add((New-Object System.Net.Cookie($Matches[1], $Matches[2], '/', ([uri]$api).Host)))
        }
        $text = [System.Text.Encoding]::UTF8.GetString($response.RawContentStream.ToArray())
        if ($text) { $text | ConvertFrom-Json }
    } catch {
        if (-not $_.Exception.Response) { throw "Cannot reach $BaseUrl - is hms-services running? ($($_.Exception.Message))" }
        $status = [int]$_.Exception.Response.StatusCode
        $code = ''
        $message = ''
        if ($_.ErrorDetails -and $_.ErrorDetails.Message) {
            try {
                $e = ($_.ErrorDetails.Message | ConvertFrom-Json).error
                $code = $e.code
                $message = $e.message
            } catch {}
        }
        $hint = if ($hints.ContainsKey($code)) { " - $($hints[$code])" } else { '' }
        throw "$Method $Path failed: HTTP $status $code $message$hint"
    }
}

function Get-AllUsers {
    $users = @()
    $after = ''
    do {
        $page = Invoke-Hms GET "/iam/users?limit=200$(if ($after) { "&after=$after" })"
        $users += @($page.users)
        $after = $page.next_after
    } while ($after)
    $users
}

function Format-User($u) {
    [pscustomobject]@{
        id          = $u.id
        name        = $u.display_name
        status      = $u.status
        signs_in_as = (@($u.identities) | ForEach-Object { $_.subject }) -join ', '
        roles       = (@($u.assignments) | ForEach-Object { $_.role_code }) -join ', '
    }
}

if (-not $Credential) { $Credential = Get-Credential -Message 'IAM administrator: Khanza user ID and password' }
if (-not $Credential) { throw 'Cancelled.' }
$me = Invoke-Hms POST '/auth/sign-in' @{
    user_id  = $Credential.UserName
    password = $Credential.GetNetworkCredential().Password
}
$Credential = $null
Write-Host "Signed in as $($me.user.display_name)."

try {
    $users = Get-AllUsers
    if (-not $Target) {
        $users | ForEach-Object { Format-User $_ } | Format-Table -AutoSize | Out-String -Width 200 | Write-Host
        Write-Host 'Run again with -Target <signs_in_as or id>. A person who is not listed must sign in to HMS once.'
        return
    }

    $matched = @($users | Where-Object { $_.id -eq $Target -or (@($_.identities) | Where-Object { $_.subject -eq $Target }) })
    if ($matched.Count -eq 0) { throw "No HMS user signs in as '$Target'. They must sign in to HMS once; run without -Target to list users." }
    if ($matched.Count -gt 1) { throw "'$Target' matches $($matched.Count) users; pass the id instead." }
    $user = $matched[0]
    if ($user.id -eq $me.user.id) { throw "'$Target' is you. $($hints.self_change_not_allowed)." }
    $held = @($user.assignments | Where-Object { $_.role_code -eq $RoleCode })

    if ($Revoke) {
        if ($held.Count -eq 0) { Write-Host "$($user.display_name) does not hold $RoleCode."; return }
        foreach ($a in $held) { Invoke-Hms POST "/iam/role-assignments/$($a.id)/revoke" @{ reason = $Reason } | Out-Null }
        Write-Host "Revoked $RoleCode from $($user.display_name). It applies to their next request."
        return
    }

    $permissions = @((Invoke-Hms GET '/iam/permissions').permissions |
        Where-Object { $_.status -eq 'active' -and $_.code -notlike 'iam.*' } |
        ForEach-Object { $_.code } | Sort-Object)
    if ($permissions.Count -eq 0) { throw 'The server has no feature permissions registered.' }

    $role = @((Invoke-Hms GET '/iam/roles').roles | Where-Object { $_.code -eq $RoleCode }) | Select-Object -First 1
    if (-not $role) {
        $role = Invoke-Hms POST '/iam/roles' @{
            code        = $RoleCode
            name        = 'Feature tester (development)'
            description = 'Every clinical, billing and tariff feature, for trying the system on a development server.'
            permissions = $permissions
        }
        Write-Host "Created role $RoleCode."
    } elseif ($role.system -or $role.status -ne 'active') {
        throw "Role $RoleCode is a system role or not active; choose another -RoleCode."
    } elseif ((@($role.permissions | Sort-Object) -join ',') -ne ($permissions -join ',')) {
        $role = Invoke-Hms PUT "/iam/roles/$($role.id)/permissions" @{ permissions = $permissions }
        Write-Host "Updated role $RoleCode."
    }
    Write-Host "Role $RoleCode holds: $($permissions -join ', ')"

    if ($held.Count -gt 0) {
        $until = if ($held[0].valid_until) { "until $($held[0].valid_until)" } else { 'without expiry' }
        Write-Host "$($user.display_name) already holds $RoleCode $until."
        return
    }
    Invoke-Hms POST "/iam/users/$($user.id)/role-assignments" @{
        role_id     = $role.id
        facility_id = $null
        valid_until = (Get-Date).ToUniversalTime().AddDays($Days).ToString('yyyy-MM-ddTHH:mm:ssZ')
        reason      = $Reason
    } | Out-Null
    Write-Host "Granted $RoleCode to $($user.display_name) for $Days days. They sign out and in again to use it."
} finally {
    try { Invoke-Hms POST '/auth/sign-out' | Out-Null } catch {}
}
