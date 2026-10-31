# ADR-0006: Python for the cdc-polling service

- Status: proposed
- Date: 2026-10-30
- Deciders: Product owner (user)

## Context
The product owner asked (2026-10-30) to implement the CDC polling pipeline (ADR-0001, ADR-0005) with "decision
stack Python and other necessary tools". Development happens on Windows, production on Ubuntu 22.04.

## Options considered
| Option | Notes |
|---|---|
| **Python 3.10+ (requested)** | Runs on Ubuntu 22.04's stock Python 3.10 and on Windows; mature MariaDB and PostgreSQL drivers; easy for the team to read. Slower than compiled languages, but the work is I/O- and database-bound. |
| Go / Java | Faster single binaries, but not what the product owner asked for. |

## Decision
_Proposed:_ Python ≥ 3.10 with
- **PyMySQL** (pure Python: no C compiler on Windows) for MariaDB,
- **psycopg 3** with binary wheels for PostgreSQL 18,
- **PyYAML** for the per-table mapping files, **python-dotenv** for `.env` loading,
- **pytest** for tests; Docker Compose only for local disposable test databases.
No ORM and no scheduler framework: one process, one loop, explicit SQL. Production runs it as a systemd
service; a container image can be added later without code changes.

## Consequences (incl. PHI / compliance impact)
- Same commands on Windows and Ubuntu (`cdc-polling …` / `python -m khanza_cdc …`), `pathlib` only.
- Credentials come from the environment or a git-ignored `.env`; `.env.example` holds placeholders.
- This ADR covers `cdc-polling` only; other services choose their stack in their own ADRs.
