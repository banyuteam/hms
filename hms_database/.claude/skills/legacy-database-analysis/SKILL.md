---
name: legacy-database-analysis
description: >
  Inspects and documents legacy MySQL schema, relationships, indexes and field semantics without modifying it.
---


# Legacy Database Analysis
Absolute rule: SELECT-only. Never propose or execute DDL/DML, triggers, stored procedure changes, index changes or legacy application changes.

Inventory schemas/tables/columns/types/keys/indexes using read-only access. Inspect privacy-safe samples. Identify business keys, timestamps, monotonic IDs, audit fields and deletion evidence. Document field semantics only with evidence or domain confirmation. Evaluate polling query selectivity against existing indexes. Record ambiguity and confidence.

Output schema inventory, data dictionary, relationship hypotheses, existing indexes, safe SELECT examples, polling feasibility and unresolved questions. Do not assume `updated_at` is reliable until tested.
