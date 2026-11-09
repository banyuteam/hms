---
name: database-engineering
description: >
  Designs PostgreSQL 18 schemas, constraints, indexes, partitioning, migrations and database reliability practices.
---


# Database Engineering
Use PostgreSQL 18 for new HMS data. Design relational schemas around clear ownership and invariants. Use PK/FK/unique/check constraints and deliberate nullability. Use `timestamptz` for instants and distinguish local clinical dates/times. Define numeric precision and units for money, measurements and dosage. Use migrations. Avoid JSONB for data requiring stable relational integrity.

Workflow: inspect workload -> define entity/lifecycle -> identifiers/constraints -> indexes from actual queries -> concurrency/transactions -> migration/backfill/rollback -> tests.

Deliver DDL, migration, constraints, indexes, representative queries, classification, rollback and test plan. Never claim performance without measurement.
