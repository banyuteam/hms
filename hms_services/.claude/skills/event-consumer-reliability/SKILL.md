---
name: event-consumer-reliability
description: >
  Builds idempotent event consumers with retry, ordering, dead-letter handling, replay and reconciliation.
---


# Event Consumer Reliability
Assume duplicate delivery. Persist processed event identity when needed. Commit side effect and processed marker atomically when they share a database. Use bounded retries with exponential backoff/jitter. Separate transient errors from permanent validation failures. Dead letters must be inspectable and replayable under authorization. Define aggregate ordering/version checks where required.

Define purpose/side effect -> idempotency -> retry classification -> DLQ/replay -> reconciliation -> metrics -> crash/duplicate tests. Never silently discard or retry forever.
