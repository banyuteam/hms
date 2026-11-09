#!/usr/bin/env bash
# Creates the HMS database, its roles and baseline privileges (bootstrap/bootstrap.psql). Run once per database as a
# PostgreSQL superuser; psql prompts for the superuser password and for the new migrator/runtime passwords.
# CI may set HMS_MIGRATOR_PASSWORD / HMS_RUNTIME_PASSWORD (and HMS_AUDITOR_PASSWORD / HMS_REPORTING_PASSWORD) instead.
#
#   scripts/bootstrap.sh [--host H] [--port P] [--superuser U] [--maintenance-db D] [--database hms] [--role-prefix X]
source "$(dirname "${BASH_SOURCE[0]}")/_common.sh"

host="${PGHOST:-127.0.0.1}"; port="${PGPORT:-5432}"; superuser="postgres"; maintenance_db="postgres"
database="hms"; role_prefix="hms_meta"
while [[ $# -gt 0 ]]; do
  case "$1" in
    --host) host="$2"; shift 2 ;;
    --port) port="$2"; shift 2 ;;
    --superuser) superuser="$2"; shift 2 ;;
    --maintenance-db) maintenance_db="$2"; shift 2 ;;
    --database) database="$2"; shift 2 ;;
    --role-prefix) role_prefix="$2"; shift 2 ;;
    *) die "unknown argument: $1" ;;
  esac
done

args=(-X -h "$host" -p "$port" -U "$superuser" -d "$maintenance_db" -v ON_ERROR_STOP=1 -v "dbname=$database")
args+=(-v "role_prefix=$role_prefix")
args+=(-f "$(psql_path "$HMS_ROOT/bootstrap/bootstrap.psql")")

echo "Bootstrapping database '$database' on $host:$port as superuser '$superuser'."
"$PSQL" "${args[@]}"
