---
name: workflow-runtime-engineering
description: >
  Implements Go workflow interpretation, state transitions, scheduling, retries and durable orchestration for approved IR.
---


# Workflow Runtime Engineering
Execute approved IR only. Persist state when restart/resume is required. Define state transitions, timeouts, idempotency for side effects, cancellation and compensation. Keep authorization/tenant scope in Go. Do not claim distributed transactions across services.

Define state machine -> step contracts/capabilities -> persistence/resume -> retry/timeout/compensation -> event correlation/order -> instrumentation -> restart/duplicate/partial-completion tests. Clinical/financial transitions require domain-owner approval.
