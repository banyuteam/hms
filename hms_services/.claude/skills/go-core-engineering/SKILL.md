---
name: go-core-engineering
description: >
  Defines Go core engine architecture, concurrency, lifecycle, capability registry, transaction authority and orchestration.
---


# Go Core Engine Engineering
Go owns API/request orchestration, authentication/authorization enforcement, database transactions and authoritative writes, workflow runtime, scheduler, capability registry, event delivery, worker lifecycle, limits and observability.

Use context cancellation, bounded concurrency, explicit transaction boundaries, no global mutable state, typed/versioned capability interfaces and independent IR/policy validation. Do not make Python a privileged peer.

Define responsibility/interface/invariants/concurrency/failure/metrics/tests before implementation.
