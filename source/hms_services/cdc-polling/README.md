# cdc-polling

**Requirement:** #2 (event capture)  
**Status:** First cut implemented and tested against MariaDB 10.6.26 + PostgreSQL 18 with synthetic data.
PRD is a draft and ADR-0005/0006 are proposed, so treat it as a spike until they are approved. Not yet run
against the hospital replica.

Copies allowlisted Khanza tables into PostgreSQL 18 (`khanza_mirror.*`) and records every insert, update
and delete in `cdc.change_event`, **without writing to Khanza**. Khanza has no `updated_at`, so changes are
found by comparing hashes of fixed-size primary-key ranges, then diffing rows only inside ranges whose hash
changed.

| | |
|---|---|
| Build plan | [`design/hms_services/cdc-polling/BUILD-PLAN.md`](../../../design/hms_services/cdc-polling/BUILD-PLAN.md) |
| PRD (draft) | [`design/hms_services/cdc-polling/PRD.md`](../../../design/hms_services/cdc-polling/PRD.md) |
| PostgreSQL DDL | [`source/hms_database/cdc-polling/`](../../hms_database/cdc-polling/) |
| Skill: add/change a table | [`.claude/skills/cdc-table-mapping/`](.claude/skills/cdc-table-mapping/SKILL.md) |
| DBA prerequisites | [`docs/source-db-prerequisites.md`](docs/source-db-prerequisites.md) |
| Claude instructions | [`CLAUDE.md`](CLAUDE.md) |

## Layout

```
mappings/<table>.yaml     one file per Khanza table: key, range size, columns, PHI flags, target table
src/khanza_cdc/
  mapping.py              loads + validates mappings (the pluggable layer)
  sqlgen.py               generates every source SELECT from a mapping
  source.py               read-only MariaDB adapter (statement allowlist, READ ONLY session, grant check)
  target.py               PostgreSQL adapter (checkpoints, row hashes, mirror, change events)
  diff.py                 pure rules: digests, diffs, range splits, adaptive intervals
  engine.py               scheduling, throttling, per-range reconciliation
  cli.py                  `cdc-polling` command
tests/unit/               no database needed
tests/integration/        disposable MariaDB 10.6 + PostgreSQL 18 (see its README)
deploy/cdc-polling.service  systemd unit example (Ubuntu 22.04)
docker-compose.dev.yml    local synthetic MariaDB + PostgreSQL
```

## How to run

Python 3.10 or newer. Commands are identical on Windows (PowerShell) and Ubuntu, except for activating the venv.

```bash
python -m venv .venv
# Windows:  .venv\Scripts\activate        Ubuntu:  source .venv/bin/activate
pip install -e ".[dev]"
copy .env.example .env      # Ubuntu: cp .env.example .env   — then fill in values; .env is git-ignored
```

Local databases (synthetic, empty) and the PostgreSQL schema:

```bash
docker compose -f docker-compose.dev.yml up -d
```

For a real PostgreSQL, apply the migrations in order with `psql` (the migration tool is not decided yet):

```bash
psql "host=... dbname=... user=..." -v ON_ERROR_STOP=1 -f ../../hms_database/cdc-polling/migrations/0001_cdc_control_schema.sql
# ... then 0002, 0003, 0004
```

Commands:

| Command | What it does |
|---|---|
| `cdc-polling validate` | Validate the mapping files (no database). |
| `cdc-polling show-sql [--table t]` | Print the generated source SQL for review (no database). |
| `cdc-polling check` | Source user is read-only, mappings match the source schema, target schema matches. |
| `cdc-polling run --once [--table t]` | One pass over the due ranges. |
| `cdc-polling run` | Poll continuously; Ctrl+C / SIGTERM finishes the range in flight. |
| `cdc-polling status` | Per-table checkpoint summary (no PHI). |
| `cdc-polling resync --table t --yes` | After a mapping change: re-apply every row on the next passes. |

`python -m khanza_cdc <command>` works too. All logs are JSON on stdout; they contain counts and range ids,
never keys or values.

Tests:

```bash
python -m pytest            # unit tests; integration tests run when CDC_IT_* is set (tests/integration/README.md)
```

## Measured on synthetic data (indicative only)

Docker containers on a 4-core dev machine, `reg_periksa` with 300 000 synthetic rows, `range.size` 5 000
(60 ranges):

| Pass | Time | Rows read on the source |
|---|---:|---:|
| Bootstrap (snapshot into an empty mirror) | 48 s | 300 000 |
| Full sweep, nothing changed (level 1 only) | 1.4 s | 300 000 |
| Full sweep, 50 updates + 100 deletes + 20 inserts in 3 ranges | 1.8 s | 314 640 |
| Next pass without forcing (adaptive schedule, nothing due) | 0.3 s | 0 |

The replica's real numbers must come from the spike (BUILD-PLAN.md §9, step 7).
