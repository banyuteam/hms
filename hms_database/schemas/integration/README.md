# Schema `integration`

- Migration: `0004_integration_polling_state.sql`
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

## Not decided yet
Captured-state snapshots and reconciliation tables (need the legacy schema inventory and PHI classification first),
run-history retention.
