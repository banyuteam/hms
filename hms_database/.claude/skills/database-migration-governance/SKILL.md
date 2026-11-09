---
name: database-migration-governance
description: >
  Plans controlled schema evolution, backfills, cutover, compatibility, rollback and reconciliation.
---


# Database Migration Governance
Version-control and review every schema change. Prefer expand-migrate-contract. Separate schema deployment from backfill. Make backfills restartable, bounded and observable. Define old/new application compatibility. Never migrate by writing to legacy source.

Workflow: identify consumers -> add compatible schema -> deploy dual-compatible code if needed -> bounded backfill -> validate counts/checksums/invariants -> controlled switch -> remove obsolete structures only after verification. Deliver migration, backfill, validation, monitoring, rollback and release sequence.
