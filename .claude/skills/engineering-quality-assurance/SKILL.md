---
name: engineering-quality-assurance
description: >
  Defines testing, code review, reliability and release-quality practices for the HMS workspace. Use when implementing, reviewing or releasing changes.
---


# HMS Engineering Quality Assurance

Test layers: unit/domain; schema and migration; API/event/protobuf/IR contract; PostgreSQL and legacy connector integration; broker and worker integration; critical end-to-end clinical/financial workflows; security and performance.

Required failure cases include duplicate events, out-of-order delivery, publisher/consumer crashes, polling timeout, checkpoint failure, partial mapping, invalid IR, unauthorized capability and worker resource exhaustion.

Review for no legacy writes, no PHI logging, bounded queries/retries, explicit idempotency/recovery, metrics and runbooks. Do not claim tests/builds passed unless executed. Report skipped tests and residual risks.
