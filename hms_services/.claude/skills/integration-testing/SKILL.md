---
name: integration-testing
description: >
  Tests end-to-end integration across Go, PostgreSQL, read-only legacy MySQL, brokers, Python DSL and healthcare integrations.
---


# Integration Testing
Test Go unit/component, PostgreSQL migration/repository, legacy read connector, event contracts, DSL compiler/IR, Python worker protocol/isolation and critical end-to-end workflows.

Required cases: legacy account cannot write; polling resumes after restart; overlap creates no duplicate side effect; snapshot maps correctly; ambiguous value quarantined; outbox survives outage; duplicate event has no duplicate side effect; retry/DLQ work; invalid IR and unauthorized capability rejected; worker timeout does not block Go; tenant boundaries hold.

Use synthetic or properly de-identified data only.
