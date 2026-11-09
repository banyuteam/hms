---
name: legacy-read-polling
description: >
  Implements read-only legacy MySQL polling, watermark management, snapshot comparison and canonical event observation.
---


# Legacy Read Polling Engineering
Purpose: capture legacy changes without modifying the source. Use SELECT-only credentials. No DDL/DML, triggers, stored procedure or index changes. Persist checkpoints/snapshots/errors only in new PostgreSQL. Apply timeouts, batch sizes, connection limits and backoff.

Strategies: reliable update timestamp; monotonic watermark for append-only inserts; snapshot comparison; periodic reconciliation. Composite cursor `(updated_at, primary_key)` where suitable; overlap windows for boundary safety. Monotonic IDs do not detect old-row updates. Snapshot only detects captured fields and may miss intermediate states. Hard deletes require existing evidence. Poll time is observation time.

Workflow: inspect schema/keys/indexes -> choose strategy per entity -> estimate source load -> define identity/snapshot -> persist state -> classify changes -> map to observed/verified events only with evidence -> reconcile/monitor. Output query spec, rationale, checkpoint, mapping, load estimate and tests.
