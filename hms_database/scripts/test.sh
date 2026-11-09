#!/usr/bin/env bash
# Runs tests/sql against a migrated development or CI database as a superuser (tests use SET ROLE to check each HMS
# role). Every test file runs in a transaction that is rolled back. Never run against production.
#
#   scripts/test.sh [--host H] [--port P] [--database hms] [--role-prefix X] [--superuser U]
source "$(dirname "${BASH_SOURCE[0]}")/_common.sh"

host="${PGHOST:-127.0.0.1}"; port="${PGPORT:-5432}"; database="hms"; role_prefix="hms_meta"; superuser="postgres"
while [[ $# -gt 0 ]]; do
  case "$1" in
    --host) host="$2"; shift 2 ;;
    --port) port="$2"; shift 2 ;;
    --database) database="$2"; shift 2 ;;
    --role-prefix) role_prefix="$2"; shift 2 ;;
    --superuser) superuser="$2"; shift 2 ;;
    *) die "unknown argument: $1" ;;
  esac
done

plan_file="$(mktemp "${TMPDIR:-/tmp}/hms_test.XXXXXX")"
trap 'rm -f "$plan_file"' EXIT

shopt -s nullglob
files=("$HMS_ROOT"/tests/sql/*.sql)
{
  printf '\\set ON_ERROR_STOP on\n'
  printf "\\\\set role_prefix '%s'\n" "$role_prefix"
  for f in "${files[@]}"; do
    printf "\\\\echo '== %s'\n" "$(basename "$f" .sql)"
    printf "\\\\i '%s'\n" "$(psql_path "$f")"
  done
  printf "\\\\echo 'All %s test files passed.'\n" "${#files[@]}"
} > "$plan_file"

echo "Testing database '$database' on $host:$port as '$superuser' (role prefix '$role_prefix')."
"$PSQL" -X -q -h "$host" -p "$port" -U "$superuser" -d "$database" -f "$(psql_path "$plan_file")"
