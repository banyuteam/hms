# Schema `eventing`

- Migration: `0003_eventing_outbox.sql`
- Writers: `hms_services` producers, outbox relay and consumers (`hms_eventing_rw`)
- Classification: confidential. Payloads carry identifiers and minimal facts, never full records.
- Envelope: `standards/contracts/event-envelope.md`

## `outbox_events`
Written in the same transaction as the business change. Envelope columns are insert-only for the runtime; only the
delivery columns (`published_at`, `dead_lettered_at`, `attempt_count`, `next_attempt_at`, `last_error`) are updatable.

Relay pattern:
```sql
SELECT id, event_id, ... FROM eventing.outbox_events
WHERE published_at IS NULL AND dead_lettered_at IS NULL AND next_attempt_at <= now()
ORDER BY next_attempt_at, id
FOR UPDATE SKIP LOCKED
LIMIT 100;
-- publish, then
UPDATE eventing.outbox_events SET published_at = now(), attempt_count = attempt_count + 1 WHERE id = $1;
-- or on failure
UPDATE eventing.outbox_events SET attempt_count = attempt_count + 1, next_attempt_at = now() + $backoff,
       last_error = $short_error_class WHERE id = $1;
```
- Delivery is at least once; consumers deduplicate.
- `id` is insertion order, not commit order. Per-aggregate ordering uses `aggregate_version`.
- `occurred_at` only when backed by evidence; polled legacy changes use `Legacy...Observed` event types and never
  set `occurred_at` from the poll time.
- Undelivered rows cannot be deleted (trigger). Retention may purge published/dead-lettered rows by `published_at`.

## `consumer_receipts`
```sql
INSERT INTO eventing.consumer_receipts (consumer_name, event_id, event_type) VALUES ($1, $2, $3)
ON CONFLICT DO NOTHING;   -- 0 rows: already processed, skip
```
In the same transaction as the consumer's effect.

## Not decided yet
Retention windows, broker choice (not required by this schema), dead-letter review process.
