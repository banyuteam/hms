#!/usr/bin/env bash
# Development helper: gives one HMS user a role holding every feature permission, so all features can be tried.
# Bash version of grant-feature-tester.ps1; needs curl and jq.
#
# Signs in to a running hms-services as an IAM administrator (the password is prompted without echo; nothing is
# stored), then only uses the IAM administration API, so every change is checked by the server and audited:
#   1. creates the role --role-code (default feature-tester) with every active permission except iam.*, or brings an
#      existing one up to date when new permissions were registered;
#   2. grants it organization-wide to --target, expiring after --days days (default 7).
# --revoke instead revokes the target's active assignments of that role. Without --target it lists the users and
# the Khanza ID each signs in as.
#
# The administrator cannot grant a role to themselves (403 self_change_not_allowed): the target must be another
# account, which must have signed in to HMS once. The target signs out and in again to get the new permissions.
# For development and test servers only; real roles are decided by the owner.
#
# Unsafe requests must carry Origin = PUBLIC_ORIGIN; by default it is read from the service's .env (only that line).
#
#   scripts/grant-feature-tester.sh [--base-url http://127.0.0.1:8080] [--origin <PUBLIC_ORIGIN>] [--env-file ../.env]
#                                   [--target <Khanza ID or HMS user id>] [--role-code feature-tester] [--days 7]
#                                   [--reason TEXT] [--revoke]
set -euo pipefail

die() { echo "error: $*" >&2; exit 1; }

base_url="http://127.0.0.1:8080"; origin=""; env_file="$(dirname "${BASH_SOURCE[0]}")/../.env"; target=""; role_code="feature-tester"; days=7
reason="Development feature testing"; revoke=false
while [[ $# -gt 0 ]]; do
  case "$1" in
    --base-url) base_url="$2"; shift 2 ;;
    --origin) origin="$2"; shift 2 ;;
    --env-file) env_file="$2"; shift 2 ;;
    --target) target="$2"; shift 2 ;;
    --role-code) role_code="$2"; shift 2 ;;
    --days) days="$2"; shift 2 ;;
    --reason) reason="$2"; shift 2 ;;
    --revoke) revoke=true; shift ;;
    *) die "unknown argument: $1" ;;
  esac
done
[[ "$role_code" =~ ^[a-z][a-z0-9_-]{1,63}$ ]] || die "--role-code must be 2-64 lowercase letters, digits, '-' or '_'"
[[ "$days" =~ ^[0-9]+$ ]] && (( days >= 1 && days <= 90 )) || die "--days must be 1-90"
command -v curl >/dev/null || die "curl is required"
command -v jq >/dev/null || die "jq is required (Windows: winget install jqlang.jq; Debian/Ubuntu: apt install jq)"

if [[ -z "$origin" && -f "$env_file" ]]; then
  origin="$(sed -nE 's/^[[:space:]]*PUBLIC_ORIGIN[[:space:]]*=[[:space:]]*["'"'"']?([^"'"'"'[:space:]]+).*/\1/p' "$env_file" | head -n1)"
fi
origin="${origin:-http://127.0.0.1:5174}"

api="${base_url%/}/api/v1"
work="$(mktemp -d "${TMPDIR:-/tmp}/hms_grant.XXXXXX")"
# The session cookie is sent by hand: with an https PUBLIC_ORIGIN it is a Secure __Host- cookie, which curl's cookie
# jar would not send to the plain-http service address.
cookie_file="$work/cookie"; headers="$work/headers"; resp="$work/response"
: >"$cookie_file"
signed_in=false
cleanup() {
  if $signed_in; then
    curl -sS -o /dev/null -X POST -H "Origin: $origin" -H "Cookie: $(cat "$cookie_file")" "$api/auth/sign-out" || true
  fi
  rm -rf "$work"
}
trap cleanup EXIT

hint() {
  case "$1" in
    invalid_credentials) echo " - the Khanza user ID or password is wrong" ;;
    forbidden) echo " - the signed-in account is not an IAM administrator" ;;
    origin_not_allowed) echo " - Origin $origin is not the server's PUBLIC_ORIGIN; pass --origin or --env-file" ;;
    unauthorized) echo " - the session ended; run the script again" ;;
    self_change_not_allowed) echo " - an administrator cannot change their own roles; use another account as the target" ;;
    conflict) echo " - it already exists or is already in force" ;;
  esac
}

# hms METHOD PATH [-]   prints the response body; with "-" the JSON request body is read from stdin.
hms() {
  local method="$1" path="$2" status code message set
  local args=(-sS -o "$resp" -D "$headers" -w '%{http_code}' -X "$method" -H "Origin: $origin")
  if [[ -s "$cookie_file" ]]; then args+=(-H "Cookie: $(cat "$cookie_file")"); fi
  if [[ "${3:-}" == "-" ]]; then args+=(-H 'Content-Type: application/json' --data-binary @-); fi
  status="$(curl "${args[@]}" "$api$path")" || die "cannot reach $base_url - is hms-services running?"
  set="$(tr -d '\r' <"$headers" | sed -nE 's/^[Ss]et-[Cc]ookie:[[:space:]]*((__Host-)?hms_session=[^;[:space:]]+).*/\1/p' | head -n1)"
  if [[ -n "$set" ]]; then printf '%s' "$set" >"$cookie_file"; fi
  if [[ "$status" != 2* ]]; then
    code="$(jq -r '.error.code // empty' "$resp" 2>/dev/null || true)"
    message="$(jq -r '.error.message // empty' "$resp" 2>/dev/null || true)"
    die "$method $path failed: HTTP $status $code $message$(hint "$code")"
  fi
  cat "$resp"
}

in_days() { # RFC 3339 UTC time N days from now (GNU date, then BSD date)
  date -u -d "+$1 days" +%Y-%m-%dT%H:%M:%SZ 2>/dev/null || date -u -v+"$1"d +%Y-%m-%dT%H:%M:%SZ
}

read -rp "IAM administrator Khanza user ID: " admin_id
read -rsp "Password: " password; echo
me="$(printf '%s' "$password" | jq -Rs --arg u "$admin_id" '{user_id: $u, password: .}' | hms POST /auth/sign-in -)"
unset password
signed_in=true
me_id="$(jq -r '.user.id' <<<"$me")"
echo "Signed in as $(jq -r '.user.display_name' <<<"$me")."

users='[]'; after=""
while :; do
  page="$(hms GET "/iam/users?limit=200${after:+&after=$after}")"
  users="$(jq -c --argjson acc "$users" '$acc + .users' <<<"$page")"
  after="$(jq -r '.next_after // empty' <<<"$page")"
  [[ -n "$after" ]] || break
done

if [[ -z "$target" ]]; then
  jq -r '["ID","NAME","STATUS","SIGNS_IN_AS","ROLES"], (.[] | [.id, .display_name, .status,
         ([.identities[]?.subject] | join(", ")), ([.assignments[]?.role_code] | join(", "))]) | @tsv' <<<"$users" |
    column -t -s $'\t' 2>/dev/null || true
  echo "Run again with --target <SIGNS_IN_AS or ID>. A person who is not listed must sign in to HMS once."
  exit 0
fi

matched="$(jq -c --arg t "$target" '[.[] | select(.id == $t or any(.identities[]?; .subject == $t))]' <<<"$users")"
case "$(jq length <<<"$matched")" in
  0) die "no HMS user signs in as '$target'. They must sign in to HMS once; run without --target to list users." ;;
  1) ;;
  *) die "'$target' matches several users; pass the id instead." ;;
esac
user_id="$(jq -r '.[0].id' <<<"$matched")"
user_name="$(jq -r '.[0].display_name' <<<"$matched")"
[[ "$user_id" != "$me_id" ]] || die "'$target' is you.$(hint self_change_not_allowed)."
held="$(jq -c --arg r "$role_code" '[.[0].assignments[]? | select(.role_code == $r)]' <<<"$matched")"

if $revoke; then
  [[ "$(jq length <<<"$held")" -gt 0 ]] || { echo "$user_name does not hold $role_code."; exit 0; }
  for id in $(jq -r '.[].id' <<<"$held"); do
    jq -n --arg r "$reason" '{reason: $r}' | hms POST "/iam/role-assignments/$id/revoke" - >/dev/null
  done
  echo "Revoked $role_code from $user_name. It applies to their next request."
  exit 0
fi

permissions="$(hms GET /iam/permissions |
  jq -c '[.permissions[] | select(.status == "active" and (.code | startswith("iam.") | not)) | .code] | sort')"
[[ "$permissions" != "[]" ]] || die "the server has no feature permissions registered"

role="$(hms GET /iam/roles | jq -c --arg r "$role_code" '[.roles[] | select(.code == $r)][0] // empty')"
if [[ -z "$role" ]]; then
  role="$(jq -n --arg c "$role_code" --argjson p "$permissions" '{code: $c, name: "Feature tester (development)",
          description: "Every clinical, billing and tariff feature, for trying the system on a development server.",
          permissions: $p}' | hms POST /iam/roles -)"
  echo "Created role $role_code."
elif [[ "$(jq -r '.system or .status != "active"' <<<"$role")" == "true" ]]; then
  die "role $role_code is a system role or not active; choose another --role-code"
elif [[ "$(jq -c '.permissions | sort' <<<"$role")" != "$permissions" ]]; then
  role="$(jq -n --argjson p "$permissions" '{permissions: $p}' |
          hms PUT "/iam/roles/$(jq -r .id <<<"$role")/permissions" -)"
  echo "Updated role $role_code."
fi
echo "Role $role_code holds: $(jq -r 'join(", ")' <<<"$permissions")"

if [[ "$(jq length <<<"$held")" -gt 0 ]]; then
  echo "$user_name already holds $role_code $(jq -r '.[0].valid_until | if . == null then "without expiry" else "until " + . end' <<<"$held")."
  exit 0
fi
jq -n --arg role "$(jq -r .id <<<"$role")" --arg until "$(in_days "$days")" --arg r "$reason" \
  '{role_id: $role, facility_id: null, valid_until: $until, reason: $r}' |
  hms POST "/iam/users/$user_id/role-assignments" - >/dev/null
echo "Granted $role_code to $user_name for $days days. They sign out and in again to use it."
