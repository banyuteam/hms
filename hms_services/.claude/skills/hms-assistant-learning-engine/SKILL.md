---
name: hms-assistant-learning-engine
description: Implement deterministic analysis, learning observations and improvement proposals in the HMS Go backend.
---
# HMS Assistant Learning Engine

## Scope
No LLM, model API, embeddings, RAG, vector DB, agent framework or model training. Use explainable aggregation, thresholds and deterministic mappings.

## Pipeline
`ingest -> validate -> normalize -> deduplicate -> persist -> aggregate -> detect pattern -> observation -> proposal`

Authenticate ingestion; validate schema/version; bound payloads and rate; derive actor identity from session; reject/redact disallowed sensitive fields; authorize referenced resources; deduplicate; safely reject unknown versions. Client data is untrusted.

## Analysis
Start with explainable statistics: fallback/unresolved rate by intent/flow version, completion/abandonment by step, correction rate by template/version, feedback distribution, and verified workflow outcome where available. Include observation type, window, sample size/denominator, grouping dimensions, evidence references, detector version and limitations. Do not infer causation from correlation or label a pattern a defect without review.

Prefer explicit guided-flow IDs and registered intent IDs. If free-text matching is used, use bounded explainable rules and return unknown/ambiguous when uncertain. Do not claim keyword matching understands arbitrary natural language.

## Proposals
Include problem, evidence/sample size, affected flow/rule/template, proposed change, rationale, expected benefit, risk, owner/reviewer and evaluation requirements. Feedback is evidence, not authority.

## Safety boundary
Never mutate active rules, templates, catalogues, authorization or workflow definitions. Analysis is side-effect-free. Publication is a separate approved process.

## Reliability and security
Follow existing Go API conventions; do not invent endpoints before inspecting the service. Use bounded work, timeouts, pagination, idempotency and stable errors. Enforce tenant/facility scope, least privilege, purpose limitation and retention. Keep PHI out of logs/traces/metrics.

## Tests
Cover duplicate/out-of-order events, malformed and unknown versions, PHI leakage, authorization, deterministic aggregation, sample thresholds, reproducibility and prevention of automatic publication.
