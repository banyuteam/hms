# Shared helpers for the hms_database bash scripts (CI, containers, Linux/macOS, Git Bash).
set -euo pipefail

HMS_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PSQL="${PSQL:-psql}"
export PGCLIENTENCODING=UTF8

die() { echo "error: $*" >&2; exit 1; }

# Path usable inside a psql \i '...' command: absolute, forward slashes, no single quote.
psql_path() {
  local p
  p="$(cd "$(dirname "$1")" && pwd)/$(basename "$1")"
  if command -v cygpath >/dev/null 2>&1; then p="$(cygpath -m "$p")"; fi
  [[ "$p" != *"'"* ]] || die "path contains a single quote: $p"
  printf '%s' "$p"
}

# SHA-256 of the file with CR bytes removed (same value as Get-MigrationChecksum in _common.ps1).
migration_checksum() {
  if command -v sha256sum >/dev/null 2>&1; then
    tr -d '\r' < "$1" | sha256sum | cut -d' ' -f1
  else
    tr -d '\r' < "$1" | shasum -a 256 | cut -d' ' -f1
  fi
}
