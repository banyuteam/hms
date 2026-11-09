#!/usr/bin/env bash
# Applies pending migrations from migrations/ in one psql session (ADR-DB-001). --plan reports without changes.
# Connects as <role-prefix>_migrator (hms_meta_migrator) by default; the password comes from the prompt, PGPASSWORD
# or a pgpass file.
#
#   scripts/migrate.sh [--host H] [--port P] [--database hms] [--role-prefix hms_meta] [--user U] [--plan]
source "$(dirname "${BASH_SOURCE[0]}")/_common.sh"

host="${PGHOST:-127.0.0.1}"; port="${PGPORT:-5432}"; database="hms"; role_prefix="hms_meta"; user=""; plan=false
while [[ $# -gt 0 ]]; do
  case "$1" in
    --host) host="$2"; shift 2 ;;
    --port) port="$2"; shift 2 ;;
    --database) database="$2"; shift 2 ;;
    --role-prefix) role_prefix="$2"; shift 2 ;;
    --user) user="$2"; shift 2 ;;
    --plan) plan=true; shift ;;
    *) die "unknown argument: $1" ;;
  esac
done
user="${user:-${role_prefix}_migrator}"
tooling="$(psql_path "$HMS_ROOT/tooling/psql/apply_one.psql")"; tooling="${tooling%/apply_one.psql}"

plan_file="$(mktemp "${TMPDIR:-/tmp}/hms_migrate.XXXXXX")"
trap 'rm -f "$plan_file"' EXIT

versions=(); steps=""; count=0
shopt -s nullglob
for f in "$HMS_ROOT"/migrations/*.sql; do
  name="$(basename "$f")"
  [[ "$name" =~ ^([0-9]{4})_([a-z0-9_]+)\.sql$ ]] || die "invalid migration file name: $name (expected NNNN_snake_case.sql)"
  version="${BASH_REMATCH[1]}"; label="${BASH_REMATCH[2]}"
  for v in "${versions[@]}"; do [[ "$v" != "$version" ]] || die "duplicate migration version $version"; done
  versions+=("$version")
  [[ "$(head -c 3 "$f" | od -An -tx1 | tr -d ' \n')" != "efbbbf" ]] || die "$name has a UTF-8 BOM"
  if grep -qiE '^[[:space:]]*(BEGIN|COMMIT|ROLLBACK|START[[:space:]]+TRANSACTION)[[:space:]]*;' "$f"; then
    die "$name contains transaction control; the runner wraps each migration in its own transaction"
  fi
  steps+="\\set m_version '$version'"$'\n'
  steps+="\\set m_name '$label'"$'\n'
  steps+="\\set m_checksum '$(migration_checksum "$f")'"$'\n'
  steps+="\\set m_file '$(psql_path "$f")'"$'\n'
  steps+="\\i '$tooling/apply_one.psql'"$'\n'
  count=$((count + 1))
done

all_versions="$(IFS=,; echo "${versions[*]-}")"
{
  printf '\\set ON_ERROR_STOP on\n'
  printf '\\set hms_plan %s\n' "$plan"
  printf "\\\\set hms_all_versions '%s'\n" "$all_versions"
  printf "\\\\i '%s/migrate_begin.psql'\n" "$tooling"
  printf '%s' "$steps"
  printf "\\\\i '%s/migrate_end.psql'\n" "$tooling"
} > "$plan_file"

echo "$([[ $plan == true ]] && echo Planning || echo Migrating) database '$database' on $host:$port as '$user' ($count migration files)."
PGAPPNAME=hms_database_migrate "$PSQL" -X -q -h "$host" -p "$port" -U "$user" -d "$database" -f "$(psql_path "$plan_file")"
