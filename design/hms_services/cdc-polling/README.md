# cdc-polling — plan & design

**Requirement:** #2 (event capture)  
**Status:** Draft PRD and build plan; first cut implemented — waiting for product-owner review

Mirrors allowlisted Khanza MariaDB tables into PostgreSQL 18 and records their changes, using hash-based
reconciliation over fixed-size primary-key ranges with independent scan checkpoints. Khanza is never written to.

This folder holds the *plan and design* of the project. The code lives in
[`source/hms_services/cdc-polling/`](../../../source/hms_services/cdc-polling/) and the PostgreSQL DDL in
[`source/hms_database/cdc-polling/`](../../../source/hms_database/cdc-polling/).

| | |
|---|---|
| Final PRD (draft) | [`PRD.md`](PRD.md) |
| Build plan | [`BUILD-PLAN.md`](BUILD-PLAN.md) |
| Skills | [`.claude/skills/cdc-table-mapping/`](.claude/skills/cdc-table-mapping/SKILL.md) |
| Decisions | ADR-0001, ADR-0004, ADR-0005, ADR-0006 in [`docs/decisions/`](../../../docs/decisions/) (all proposed) |
| Code | [`source/hms_services/cdc-polling/`](../../../source/hms_services/cdc-polling/) |
