---
name: postgresql-resource-budgeting
description: Plan PostgreSQL CPU, memory, connections and workload limits across Windows development, Linux development and Linux production.
---


# PostgreSQL Resource Budgeting

## Core principle
PostgreSQL does not provide a native exact CPU/RAM allocation per database role. A 75/25 split is an infrastructure planning budget, not a role quota.

## Required analysis
- Host/container CPU and RAM.
- OS and supporting service reserve.
- PostgreSQL service/container limits.
- `max_connections`, application replicas and pool maximums.
- Migration, monitoring, backup and reserved admin connections.
- `shared_buffers`, `work_mem`, `maintenance_work_mem`, worker settings and autovacuum.
- Storage capacity, IOPS/latency, WAL growth and backup throughput.

## Platform
- Windows: distinguish host, Docker Desktop and WSL2 resource constraints.
- Linux: use systemd/cgroups or container resource controls where appropriate.
- Production: Linux only.

## Guardrails
- Never set `shared_buffers` to 75% RAM just to satisfy the policy.
- `work_mem` can multiply across operations and concurrent sessions.
- `effective_cache_size` is a planner estimate, not reserved memory.
- Do not increase `max_connections` without calculating aggregate pool demand.
- Load-test representative peak concurrency and watch OOM, throttling, lock waits, pool wait and I/O latency.
- Document measured baseline, target, alert thresholds and rollback.
