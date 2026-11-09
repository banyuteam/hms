---
name: backend-service-engineering
description: >
  Designs modular Go backend services, domain workflows, concurrency, dependency boundaries and runtime lifecycle.
---


# Backend Service Engineering
Go is the primary runtime. Separate transport, application orchestration, domain logic and persistence adapters. Use explicit interfaces at meaningful boundaries, context cancellation/deadlines, bounded goroutines/queues/pools, explicit transactions and typed errors. Keep domain logic testable without infrastructure.

Workflow: identify service/data owner -> define command/query/event -> invariants and authorization -> transaction/concurrency -> adapters/observability -> test success/failure/cancellation/contention -> document operations. Do not put business logic in handlers or write another service's tables.
