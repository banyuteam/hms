---
name: event-streaming-engineering
description: >
  Implements event publication, transactional outbox, broker integration, schema compatibility and operational event flow.
---


# Event Streaming Engineering
Streaming is asynchronous propagation, not full Event Sourcing. Native writes use transactional outbox in the same transaction. Legacy polling emits observed changes after classification. Broker is not the system of record. Contracts are governed in database/shared standards. Go owns publisher, retries and delivery. Assume at-least-once; consumers idempotent. Minimize PHI.

Workflow: confirm contract/owner -> define stream/partition/retention -> implement outbox/adapter persistence -> publish with retry -> consumer idempotency -> ordering/replay/dead-letter -> compatibility and operational tests.

Test commit/publish gap, lost acknowledgement, consumer crash, duplicates, out-of-order delivery, schema mismatch and broker outage. Never publish before commit or assume end-to-end exactly-once.
