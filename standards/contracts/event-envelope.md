# Canonical Event Envelope — Baseline

Conceptual fields: `event_id`, `event_type`, `event_version`, `source`, `recorded_at`, optional evidence-backed `occurred_at`, optional `published_at`, `tenant_id`, `aggregate_type`, `aggregate_id`, `aggregate_version`, `correlation_id`, `causation_id`, `actor`, `classification`, and minimal `data`.

Rules:
1. Do not place full patient charts or unnecessary PHI in events.
2. Prefer stable identifiers and authorized follow-up reads.
3. Never invent actor or occurrence time from polling time.
4. Distinguish `Legacy...Observed` from verified domain events.
5. Prefer additive evolution; breaking changes require a new version and compatibility plan.
6. Consumers tolerate duplicates.
7. Include tenant and aggregate context where required.
