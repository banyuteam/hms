# Schema `integration`

- Migrations: `0004_integration_polling_state.sql`; `0016_integration_interoperability.sql` (ADR-DB-004)
- Writer: `hms_services` legacy read-polling adapter (`hms_integration_rw`)
- Classification: confidential (cursors may hold legacy business keys such as encounter numbers)
- Policy: `standards/security/legacy-read-only-policy.md`. The legacy MySQL source is never written; its polling
  state lives here.

## Tables
- `poll_checkpoints`: durable cursor per stream. `cursor_value` is a JSON array/object (NULL before the first batch).
  Advance with optimistic concurrency: `... WHERE stream_name = $s AND cursor_version = $v`; zero rows = lost race.
  `last_error_code` is an error class, never a message, SQL text or row content.
- `poll_leases`: one active poller per stream. Acquire/take over:
  ```sql
  INSERT INTO integration.poll_leases (stream_name, holder, fence, expires_at)
  VALUES ($s, $holder, 1, now() + $ttl)
  ON CONFLICT (stream_name) DO UPDATE
  SET holder = EXCLUDED.holder, fence = poll_leases.fence + 1, acquired_at = now(), expires_at = EXCLUDED.expires_at
  WHERE poll_leases.expires_at < now() OR poll_leases.holder = EXCLUDED.holder;
  ```
  The fence grows with every acquisition; a holder compares it before writing a checkpoint.
- `sync_runs`: one row per polling run with counts and outcome (`running|succeeded|failed|abandoned`).

Times recorded here are observation times, not business-event times.

## Interoperability (0016)
Tenant row-level security applies to these tables: workers set `hms.organization_id` per batch.
- `external_systems`: the systems HMS exchanges with: `legacy-hms` (SIMRS Khanza, read-only), `satusehat`, `pacs`.
  It holds no endpoints or credentials.
- `legacy_record_links`: crosswalk from a legacy row `(source_system, source_entity, source_key)` to a canonical
  record.
  - One active link per legacy key and resource type.
  - `source_row_sha256` detects source changes.
  - Superseding or rejecting a link needs a reason; links are never deleted.
  - Khanza itself is never written.
- `external_resource_ids`: ids assigned by an external platform (SATUSEHAT resource ids), one active per record and
  per external id.
- `outbound_submissions`: queue and history of resource-version submissions. Each submission has an idempotency key
  (unique per system) and records status, attempts, HTTP status and error class.
  - The payload hash is stored; the payload never is.
  - Accepted submissions record `accepted_at` and the external id.
  - Due work: `WHERE status IN ('pending', 'failed') AND next_attempt_at <= now() ORDER BY next_attempt_at, id FOR
    UPDATE SKIP LOCKED`.
- `validation_results`: append-only FHIR profile validation outcome per resource version. Issues are recorded as
  severity, code and expression only, never values.

## Not decided yet
The legacy import (Khanza → native record) and its reconciliation, captured-state snapshots and reconciliation tables (need the legacy schema inventory and PHI classification first),
run-history retention.
