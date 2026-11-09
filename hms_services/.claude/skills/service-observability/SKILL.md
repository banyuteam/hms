---
name: service-observability
description: >
  Designs structured logging, metrics, tracing, health checks and operational alerts for services, polling, DSL and consumers.
---


# Service Observability
Never leak PHI, credentials or tokens. Propagate correlation/trace IDs across API, polling, outbox, broker and consumers. Use bounded-cardinality labels. Define actionable SLIs and alerts.

Measure API latency/errors/saturation; DB pool/query timeouts; polling lag/duration/rows/checkpoint age; outbox backlog/oldest age; publish failures/consumer lag; consumer duration/retries/DLQ; DSL compile/execute failures/duration; worker queue/timeouts/resources; reconciliation mismatches.

Define operational questions -> instrument -> redact -> dashboards/thresholds from baseline -> runbooks -> test alerts.
