# Legacy Database Read-Only Policy

- Dedicated SELECT-only account per environment/source; never reuse legacy application credentials.
- No writes, DDL, triggers, stored procedure changes, index changes or legacy app changes.
- Checkpoints, snapshots and errors live in new-system PostgreSQL.
- Apply connection limits, query timeouts, bounded batches and backoff.
- Inspect existing indexes and query plans; do not add indexes to legacy.
- Never log patient payloads or credentials.
- Prefer proven reliable update timestamps; use composite cursors where appropriate.
- Monotonic IDs detect inserts, not updates to old rows.
- Snapshot comparison detects only captured fields and can miss intermediate states.
- Hard deletes require existing tombstones, audit evidence or full-snapshot reconciliation.
- Poll time is observation time, not business occurrence time.
