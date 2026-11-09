---
name: hms-desktop-background-agents
description: Design reliable background workstation agents for print queues, device monitoring, synchronization and health reporting.
---
# HMS Desktop Background Agents

## Purpose
Run approved workstation tasks independently from the visible WebView lifecycle.

## Process boundaries
Decide whether a capability belongs in:
- the main desktop process;
- a supervised child process;
- an OS service/daemon installed separately.

Do not automatically create a privileged system service. Use the least-privileged execution context. Document installation, startup, upgrade, shutdown and removal.

## Agent lifecycle
Define states such as `starting`, `ready`, `degraded`, `stopping`, `stopped`, `failed`. Implement heartbeat, bounded retry with backoff, cancellation, graceful shutdown, health reporting and crash recovery. Avoid duplicate workers and duplicate side effects.

## Job processing
For backend-originated jobs:
- authenticate the desktop agent;
- register and authorize workstation/device assignment;
- validate job schema and expiry;
- use idempotency and job leases where appropriate;
- distinguish accepted, executing, completed, failed and outcome-unknown;
- report result to backend;
- reconcile uncertain outcomes before retrying non-idempotent work.

Do not treat the desktop as the source of truth for business state.

## Offline behavior
Offline queues must have explicit data scope, encryption, expiry, size limits, retry policy and conflict resolution. Do not cache the full patient database. Never perform sensitive actions offline unless a specific approved workflow defines authority, limits and reconciliation.

## Observability
Use structured logs, health metrics and correlation IDs. Avoid PHI, patient identifiers and secrets in logs/metrics. Provide diagnostic export with redaction.

## Tests
Test process crash, OS restart, network loss, duplicate delivery, job expiry, shutdown during work, update during work, permission loss and storage exhaustion.
