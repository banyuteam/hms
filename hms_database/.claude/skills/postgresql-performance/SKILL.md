---
name: postgresql-performance
description: >
  Analyzes PostgreSQL 18 query plans, indexes, locking, connection behavior, partitioning and workload performance.
---


# PostgreSQL Performance
Measure before optimizing. Use EXPLAIN ANALYZE/BUFFERS safely on representative controlled workloads. Index actual filters/joins/order/selectivity; account for write amplification and vacuum. Avoid unbounded queries and N+1 access. Define pool sizing and transaction duration. Partition only when volume, retention or maintenance justifies it.

Capture workload -> inspect plan/rows/I/O/locks -> propose minimal change -> benchmark before/after -> review write cost -> document measured result and regression guard. Never invent benchmark numbers.
