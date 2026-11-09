---
name: event-contract-engineering
description: >
  Defines versioned event envelopes, taxonomy, payload schemas, compatibility and persistence contracts.
---


# Event Contract Engineering
Events describe facts; commands request actions. Define canonical meaning before broker/topic details. Distinguish `Legacy...Observed` from verified domain events. Include stable identity, type/version, source, evidence-backed timestamps, correlation/causation and aggregate context. Minimize PHI. Design for at-least-once and idempotent consumers. Define ordering scope and schema deprecation.

Workflow: purpose/owner -> trigger/source evidence -> payload/classification -> identity/version/ordering -> consumer/failure semantics -> compatibility tests -> rollout/deprecation. Never infer actor or occurrence time from poll time.
