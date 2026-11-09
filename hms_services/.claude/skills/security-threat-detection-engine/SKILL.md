---
name: security-threat-detection-engine
description: Engineer security telemetry collection, threat rules, risk scoring, incident handling and controlled response for HMS.
---
# Security Threat Detection Engine

## Signal sources
Ingress/WAF, HTTP middleware, authentication, authorization, sessions, device registration, sensitive resource access, integration adapters, database pool health, worker queues and host telemetry.

## Required architecture
Collectors -> normalized security events -> counters/window aggregation -> versioned detectors -> risk assessment -> alerts/incidents -> policy-driven response -> audit evidence.

## Detection rules
- Define event schema, source, time window, grouping key, threshold, severity, confidence, false-positive handling and response.
- Use multiple signals for high-impact decisions.
- Distinguish observation from confirmed compromise.
- Avoid PHI and high-cardinality identifiers in metric labels.
- Keep durable incident evidence in PostgreSQL; send high-volume metrics/logs to observability systems.
- Record detector/rule version and response rationale.
- Make response actions scoped, time-bounded, reversible and auditable.
- Require human approval for destructive/high-impact actions unless an approved emergency policy explicitly permits automation.

## DDoS
Measure request rate, concurrent connections, connection establishment, latency, error rates, ingress saturation, CPU/memory and database pool pressure. Coordinate upstream/CDN/WAF/network mitigation. Never claim the application alone can mitigate volumetric DDoS.

## Tests
Include rule unit tests, time-window tests, replay tests, false-positive tests, multi-replica behavior, rate-limit tests, incident lifecycle tests and response rollback tests.
