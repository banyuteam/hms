---
name: shared-postgresql-platform
description: Design PostgreSQL as a workspace-level persistence platform with explicit schema ownership, least-privilege access and safe evolution.
---
# Shared PostgreSQL Platform

## Use when
Creating or changing workspace-wide schemas, database roles, connection budgets, cross-domain relationships, platform persistence or database topology.

## Required method
1. Confirm the domain owner and data classification.
2. Decide whether the data belongs in PostgreSQL or another system (secrets, metrics, logs, files, cache, broker).
3. Define schema boundary, identifiers, constraints, indexes, retention and lifecycle.
4. Define runtime, migration, reporting and legacy credentials separately.
5. Document which service owns writes and which consumers use APIs/read models.
6. Calculate connection budgets across replicas and reserve administrative/migration capacity.
7. Provide migrations, integrity tests, backup/restore impact and performance evidence.
8. Update ERD, data dictionary, ownership matrix and ADR where material.

## Rules
- PostgreSQL 18 target; verify extensions and hosting support.
- Start with one cluster/database and multiple schemas unless evidence supports separation.
- No superuser runtime accounts.
- No frontend connections.
- No secrets or private keys in tables.
- Do not make PostgreSQL an unlimited log store, object store or message broker.
- Legacy MySQL remains external and SELECT-only.
