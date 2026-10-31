# Integration tests

They need a **disposable** MariaDB 10.6 and PostgreSQL 18 — never Khanza, never a shared database.
The tests drop and recreate the database `cdc_it_khanza_synthetic` (MariaDB) and the schemas `cdc` and
`khanza_mirror` (PostgreSQL), load synthetic rows, and connect the engine with a SELECT-only user they create.

```
docker compose -f docker-compose.dev.yml up -d
```

PowerShell (Windows):

```powershell
$env:CDC_IT_SOURCE_HOST="127.0.0.1"; $env:CDC_IT_SOURCE_ADMIN_USER="root"; $env:CDC_IT_SOURCE_ADMIN_PASSWORD="dev-root-only"
$env:CDC_IT_TARGET_HOST="127.0.0.1"; $env:CDC_IT_TARGET_USER="postgres"; $env:CDC_IT_TARGET_PASSWORD="dev-postgres-only"; $env:CDC_IT_TARGET_DATABASE="hms_cdc"
python -m pytest
```

bash (Ubuntu):

```bash
export CDC_IT_SOURCE_HOST=127.0.0.1 CDC_IT_SOURCE_ADMIN_USER=root CDC_IT_SOURCE_ADMIN_PASSWORD=dev-root-only
export CDC_IT_TARGET_HOST=127.0.0.1 CDC_IT_TARGET_USER=postgres CDC_IT_TARGET_PASSWORD=dev-postgres-only CDC_IT_TARGET_DATABASE=hms_cdc
python -m pytest
```

Optional: `CDC_IT_SOURCE_PORT`, `CDC_IT_TARGET_PORT`. Without these variables the integration tests are skipped
and only the unit tests run.

Covered: Python/MariaDB digest parity, keyset order with ENUM keys, snapshot → insert/update/delete detection
(incl. value → NULL and a deleted key coming back), range splits (keyset and int_range), crash in the middle of a
pass, mapping change → resync, read-only user enforcement, mapping vs source schema check, and that the
generated keyset query is an index range scan (`EXPLAIN`).
