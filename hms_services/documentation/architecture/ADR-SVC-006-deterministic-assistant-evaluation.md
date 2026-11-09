# ADR-SVC-006: Deterministic assistant evaluation — claim readiness first

- Status: Accepted 2026-11-09 (owner accepted the proposals for O-1 to O-8); implemented in hms_services (Phase 3)
  and used by hms_workspace/web (Phase 4)
- Date: 2026-11-09
- Owners: hms_services
- Affected projects: hms_services (owner), hms_workspace/web (consumer), hms_database (existing audit and iam tables only)
- Related: `contracts/api/assistant-v1.openapi.yaml` 1.0.0, `clinical-timeline-v1` 1.2.0, ADR-SVC-003,
  ADR-SVC-004, `standards/contracts/assistant-context-reference-contract.md` (HMS-CRC),
  `hms_workspace/web/docs/assistant-inventory.md` (Phase 1 baseline, findings F-1 to F-11)

## Context
The web assistant is rule-based and runs only in the browser. Its claim-readiness checks (`select.ts` `claimChecks`)
and the rule deciding which payers need a claim are domain rules, which root `CLAUDE.md` §4 and the
`hms-assistant-workspace-governance` skill place in `hms_services`. The Phase 1 inventory also found gaps in the
browser checks (F-1 to F-6). There is no assistant API, rule engine or assistant persistence today.

Scope of this phase, from the governance skill: deterministic rules only. No language model, agent, embeddings or
generated text. The optional AI-agent parts of `hms-insurer-claim-virtual-assistant-backend` are out of scope (F-11).

## Decision
1. **Module.** New Go package `hms_services/assistant/`, built like `clinical/` and `tariffs/`: a handler registered on
   the shared mux, `RequireSession` and `RequirePermission` from `platform/iam`, errors in the `httpx` envelope, audit
   through the existing writer. Rule logic in a sub-package with no HTTP or database imports.
2. **API (assistant-v1 1.0.0).** Two routes only:
   - `GET /api/v1/assistant/rule-sets`: the rule sets the service runs, with version and accepted resource types.
     Static, no PHI, not audited.
   - `POST /api/v1/assistant/rules/evaluate`: evaluate one rule set against explicit context references.
   Guided flows, catalogue lookup, actions and stored evaluations are not in 1.0.0. They are added as minor versions
   when a real flow needs them.
3. **Context references (HMS-CRC).** The body carries `context.references[]` with `resource_type` and `resource_id`.
   In 1.0.0 the only type is `encounter`, the id is the encounter number (business identifier, ADR-SVC-003 Decision 2),
   and exactly one reference is accepted. The id travels in the body, never in the URL. No `conversation_id` and no
   `version` field: evaluations are stateless and legacy encounters have no version. The result is a snapshot at
   `evaluated_at`.
4. **Authorization.** Route permission `assistant.rules.evaluate` (O-6). Each rule set also declares the data
   permission it reads with; `claim-readiness` requires `encounter.clinical.read`. That permission is checked for the
   reference **before** any lookup, so a denial says nothing about whether the encounter exists. Facility scope is the
   session facility (ADR-SVC-003 Decision 3). The POST route uses the same Origin and JSON checks as other state
   changing requests. Phase 3 has to export a small helper from `platform/iam` for both, because `unsafeRequestAllowed`
   and the service's `Authorize` are currently internal to that package.
5. **Data.** The rule set reads the visit through the existing `legacyhms` timeline reads (the statements behind
   `GET /encounters/{number}/timeline`). No new legacy statement, no copy in PostgreSQL.
6. **Rule set `claim-readiness`, version 1.** Defined in Go code, immutable: any change in behaviour is a new version
   number. One active version per rule set; rollback means deploying the previous build. Rules stored as data, with a
   draft-to-published lifecycle, need a later ADR. Evaluation is side-effect free and gets `evaluated_at` from the
   caller; no rule reads the clock.

   Applicability: payer code trimmed and upper-cased; `''`, `-`, `UMU`, `KRX` → `status: not_applicable`, reason
   `payer_not_claimable`, no findings (owner decision 2026-11-09, moved from `select.ts`; fixes F-2).

   | Rule id | Port of | Result | Severity if failed (O-1) |
   | --- | --- | --- | --- |
   | `sep_present` | `sep` | payer `BPJ` only. 1.0.0: always `not_evaluated`, reason `source_not_connected` (F-1) | error |
   | `primary_diagnosis_coded` | `primaryDx` | `passed` with at least one diagnosis, else `failed` (`missing`) | error |
   | `discharge_summary_present` | `dischargeSummary` | inpatient: present → `passed`, else `failed`; outpatient → `not_applicable`; care setting unknown → `not_evaluated` (F-4, O-3) | error |
   | `primary_diagnosis_matches_summary` | `dxMatchesSummary` | inpatient with summary and diagnosis: equal codes (trimmed, upper-cased, O-4) → `passed`, summary without a main diagnosis code → `failed` (`missing`), else `failed` (`mismatch`); summary or diagnosis missing → `not_evaluated` (`prerequisite_failed`); outpatient → `not_applicable`; unknown → `not_evaluated` | warning |
   | `doctor_procedures_coded` | `procedureCoded` | a billed action not by a nurse only: coded procedure present → `passed`, else `failed`; none and no billed-action section truncated → `not_applicable`; none but a section truncated → `not_evaluated` (F-5) | warning |
   | `length_of_stay_recorded` | `lengthOfStay` | inpatient: the chosen room stay (O-2) has a length of stay → `passed`, else `failed`; room stays truncated → `not_evaluated` | error |
   | `discharge_status_recorded` | `dischargeStatus` | as above for discharge status; `''` and `-` mean not recorded | error |

7. **Result shape.** `evaluation_id` (UUID), `status` (`complete`, `partial` when a finding is `not_evaluated`,
   `not_applicable`), `evaluated_at`, `rule_set {id, version}`, `reference` (the evaluated reference, echoed),
   `applicability`, `findings[]` (`rule_id`, `result`, `severity`, `reason`, `fields` as paths into the
   clinical-timeline-v1 response, `human_review`), `summary` counts and `data_completeness` (unconnected sources,
   truncated sections). Findings carry codes, never record values or prose; the workspace localizes by rule id and
   reason. There is no single `valid` flag, and the contract states that a complete checklist is not insurer
   acceptance.
8. **Audit.** One event per evaluation: category `data_access`, action `assistant.rules.evaluate`, resource
   `Encounter`/number, detail `{evaluation_id, rule_set, version, status, failed, not_evaluated}` (counts and codes
   only). Denied and not-found references are audited as failures. If the event cannot be written the result is not
   returned (503), as in ADR-SVC-003 Decision 5.
9. **Limits.** Body at most 4 KiB, unknown fields rejected, one reference, `resource_id` pattern `^[0-9/]{1,17}$`
   (same as the encounter routes), 10-second request deadline on top of the legacy statement timeout, and a per-user
   limit on evaluations (O-5) answered with 429 `too_many_requests` and `Retry-After`.

## Alternatives considered
1. Keep the checks in the browser and only document them: leaves a domain rule in the client, two answers for the same
   visit (F-2) and no audit of who checked what.
2. Add a `claim_readiness` block to `clinical-timeline-v1`: quick, but ties the checklist to one read endpoint and gives
   it no rule-set version, evaluation id or room to grow into other rule sets.
3. Generic rule engine with rules stored in PostgreSQL first: the skill's long-term shape, but a schema, a lifecycle and
   an authoring path before there is one rule set to run. Deferred until a second rule set or non-developer authoring
   is needed.

## Consequences
- Positive: one authoritative claim checklist; versioned, audited results; the gaps F-1 to F-5 become visible as
  `not_evaluated` instead of a wrong state.
- Negative: answers depend on Khanza availability (as every clinical read); one more call per claim question.
- Operational: no migration, no new configuration. New permissions are registered at startup like `clinical.Permissions`.
- Compatibility: additive API. The web keeps working unchanged until Phase 4 switches it to the endpoint.
- Security/privacy: no PHI in the URL, the audit detail or the response beyond rule codes and field paths; data
  permission checked before lookup; every evaluation audited and fail-closed.
- Patient-safety: read-only, gives no clinical advice, proposes no codes and never says a claim will be accepted.
  `human_review` is true on every `failed` and `not_evaluated` finding.

## Ownership impact
`hms_services` implements and owns the rules and the API. `hms_workspace/web` consumes it (Phase 4) and keeps topic
detection, read-back and the refusal guard. `hms_database` is unchanged: the existing `audit.audit_events` (0002) and
`iam.permissions` (0005) are used.

## Migration and rollout
1. Phase 3: implement the package and routes behind the new permission; no role receives it by default.
2. Owner grants `assistant.rules.evaluate` to the casemix role on dev; compare results with the browser checks on real
   visits (they differ where F-2 to F-6 apply, and the differences are reviewed).
3. Phase 4: web calls the endpoint for the claim topic and the Records claim section; the browser `claimChecks` is
   removed once both use the service.
4. Rollback: remove the permission from roles (UI falls back to "validation unavailable"), or deploy the previous build.

## Owner decisions (2026-11-09: proposals accepted)
- O-1: severity per rule as in the Decision 6 table.
- O-2: length of stay and discharge status come from the **last** room stay in timeline order (the one the patient
  left from; undated stays sort last), not the first (F-3).
- O-3: care setting `unknown` → `not_evaluated`, not `not_applicable` (F-4).
- O-4: diagnosis codes are compared trimmed and upper-cased (F-6).
- O-5: 60 evaluations per user per minute, per process (the ingress must also rate-limit, as for sign-in).
- O-6: permission `assistant.rules.evaluate`; no role receives it by default. The owner grants it in User & Access.
- O-7: SEP stays `not_evaluated` (`source_not_connected`) in claim-readiness v1. Reading the legacy SEP table needs a
  separate contract change; connecting it will be claim-readiness v2. **Done 2026-11-09 (ADR-SVC-007):** v2 reads
  `bridging_sep`; v1 is retired.
- O-8: deterministic-only scope confirmed; the AI-agent sections of `hms-insurer-claim-virtual-assistant-backend` are
  marked deferred in that skill.

## Implementation (Phase 3, 2026-11-09)
- `assistant/rules`: `RuleSet`, `Finding`, `Outcome`, `ClaimReadiness` v1 and `EvaluateClaimReadiness(Visit)`. No
  HTTP, database or clock.
- `assistant`: handler, registry (rule set → data permission → evaluator), `VisitOf(clinical.Timeline)`. The timeline
  is mapped with `clinical.MapTimeline`, the same mapping as `GET /encounters/{number}/timeline`.
- `platform/iam`: two exported helpers, `Handler.AllowStateChange` (the existing same-origin and JSON checks) and
  `Handler.Can` (permission check inside a handler; denials audited as before). Existing behaviour unchanged.
- `core/httpx`: `WindowLimiter` moved from `platform/iam` unchanged, so sign-in and the assistant share it.
- `cmd/hms-services`: routes registered; `assistant.Permissions` added to the permission registry (registered at
  startup, no migration).

## Implementation (Phase 4, web, 2026-11-09)
- `hms_workspace/web/src/api/claimApi.ts`: the client (`POST /assistant/rules/evaluate`, answer validated with Zod;
  another visit or an unknown result/status is `BAD_SHAPE`). Demo data (`VITE_DATA_SOURCE` not `bff`) shows fixed
  answers for the synthetic visits (`src/data/claimFixtures.ts`), written by hand in the contract shape; the browser
  computes nothing. This replaces the earlier idea of labelled local checks.
- The browser rules are removed: `claimChecks`, `isClaimable` and the no-claim payer list are gone from `select.ts`.
  `isBpjs` stays, only to decide whether SEP records are shown.
- Records window: the claim section shows the server's findings, a "checking" line, a refusal note (live without
  `assistant.rules.evaluate`, so no refused request is sent) or an error with Try again. It is left out only when the
  server answers `not_applicable` (owner decision 2026-11-09 unchanged).
- Assistant: a claim question needs only a tagged visit (not loaded in the browser). The answer bubble shows
  "checking on the server…" until the result arrives, then every finding; a failure says nothing was checked. Results go
  through the shared data cache, so the panel and an open Records window agree. A result that arrives after sign-out
  matches no message and is dropped.
- Unknown rule ids are shown as "unknown check", never as passed.

## Acceptance criteria
- [x] Owner decisions O-1 to O-8 recorded.
- [x] assistant-v1 contract reviewed by the hms_workspace owner (2026-11-09).
- [x] Web: client, Records claim section and assistant claim answer use the server; browser rules removed; tests for
      shape validation, request body, error kinds, finding display, pending and late answers, payer cases.
- [x] Unit tests for every rule and result, including the cases of `select.test.ts` and F-2 to F-6
      (`assistant/rules/claim_test.go`).
- [x] Determinism: the same input gives byte-identical results; rules read no clock.
- [x] HTTP tests (`assistant/assistant_test.go`): no session (401 on both routes), data permission missing (no lookup
      made, denial audited), permission service down, unknown rule set and version, unknown and nested unknown field,
      trailing data, zero and two references, wrong resource type, bad id, oversize body, not found (audited as failure),
      legacy outage, audit failure → 503 with no result, foreign Origin, wrong content type, per-user rate limit.
      The route permission itself is the shared `RequirePermission` middleware, tested in `platform/iam`.
- [x] Response and audit events contain no record value (tested).
- [x] `check-clinical-read` unchanged (no new statement).
- [ ] Owner grants `assistant.rules.evaluate` on dev and compares results with the browser checks on real visits.
