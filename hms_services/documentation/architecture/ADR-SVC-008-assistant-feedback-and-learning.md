# ADR-SVC-008: Assistant feedback and learning loop — structured feedback on claim findings first

- Status: Proposed (2026-11-09). No code until the owner decisions L-1 to L-10 below are taken.
- Date: 2026-11-09
- Owners: hms_services (API, ingestion, analysis); hms_database (schema, roles, retention); hms_workspace/web (feedback UI)
- Affected projects: hms_services, hms_database, hms_workspace/web
- Related: ADR-SVC-006 (claim-readiness evaluation), ADR-SVC-007 (SEP rules), `contracts/api/assistant-v1.openapi.yaml`
  1.0.0, `standards/contracts/assistant-context-reference-contract.md` (HMS-CRC), ADR-DB-002 (roles), skills
  `hms-assistant-learning-engine`, `hms-assistant-improvement-governance`, `hms-assistant-evaluation-and-regression`,
  `hms-assistant-learning-data`, `hms-assistant-learning-ux`, `hms-assistant-interaction-telemetry`

## Context
The assistant is deterministic (ADR-SVC-006). Claim readiness runs on the server as an immutable, versioned rule set
(currently v3, 9 rules) and every evaluation is audited. There is no way today for casemix staff to say that a finding
looks wrong or unclear, so rule owners learn about problems only by word of mouth, and nobody can tell which rule or
label causes most confusion.

Facts that constrain the design:
- Evaluations are stateless: the result has an `evaluation_id`, but only the audit event records it, and the runtime
  role `hms_meta_runtime` can insert audit rows and read back nothing but `event_id` (`hms_audit_append`, migration
  0002). The service therefore cannot check a feedback item against the audit trail without a wider grant.
- Findings carry codes and field paths, never record values (ADR-SVC-006 Decision 7). Feedback must keep that property.
- Learning must never change rules, catalogues or authorization on its own (governance skill): it produces evidence and
  proposals; a new rule-set version is still a code change, reviewed and released as today.

## Decision (proposed)
Phase A only: capture structured feedback and report deterministic aggregates. Observations and proposals (Phase B) and
evaluation datasets and release gates (Phase C) get their own ADRs once Phase A has data.

1. **What can be reported.** Two optional kinds, both about a claim-readiness evaluation the same person ran:
   - **Finding feedback:** `rule_id`, the `result` they saw, and one reason from a fixed list (L-2): `result_wrong`
     (the record says otherwise), `unclear` (the label or explanation is hard to understand), `not_relevant` (this check
     does not apply to this visit).
   - **Answer feedback** (learning-UX skill): `helpful`, `partially_helpful` or `not_helpful`, and for the last two an
     optional expected-output category: `more_specific`, `different_interpretation`, `actionable_steps`,
     `additional_information`, `other`.

   No free text in Phase A (L-3): free text in a clinical context will contain PHI. Interaction telemetry (topic
   chosen, fallback shown, abandonment) is not part of Phase A (L-10).
2. **Evaluation receipt (L-1).** When an evaluation is returned, the service also writes a receipt: `evaluation_id`,
   actor user id, organization and facility, rule set id and version, `evaluated_at`, and each `rule_id` with its
   result. No encounter number and no record values: the audit event already links the evaluation to the encounter for
   authorized reviewers. Feedback must reference a receipt of the same user and facility, for a rule in it, with the
   result it recorded, within 7 days (L-5). This keeps lineage without granting the runtime read access to audit.
3. **API (assistant-v1 1.1.0, additive).**
   - `POST /api/v1/assistant/feedback` `{evaluation_id, rule_id, reason}` for a finding, or
     `{evaluation_id, helpfulness, expected}` for the answer. Session required, permission
     `assistant.feedback.submit` (L-4), same Origin and JSON checks as other state-changing requests, body at most 1 KiB,
     unknown fields rejected, per-user rate limit. Idempotent: one feedback item per user, evaluation and rule (a repeat
     with the same reason returns the stored item; a different reason replaces it, recorded as a new version).
     `201` with `{feedback_id}`; `404` for an unknown or expired receipt (no detail about why); `422` for a rule that was
     not in the evaluation.
   - `GET /api/v1/assistant/feedback/summary?rule_set=claim-readiness&version=3&from=&to=`: counts per rule, result and
     reason, with the number of evaluations in the window as denominator. Permission `assistant.feedback.review`
     (L-4). Groups with fewer than 5 items show as "fewer than 5" (L-6), and no user ids are returned.
4. **Persistence (hms_database, migration `0006`, L-7).** A new schema `assistant` owned by `hms_meta_owner`, written
   through a new group role `hms_assistant_rw` (added to `bootstrap.psql` first, granted to `hms_meta_runtime`):
   `assistant.evaluation_receipts` (append-only, short retention) and `assistant.finding_feedback` (append-only versions,
   unique current item per user, evaluation and rule). Reporting reads through `hms_report_read` on a view that exposes
   aggregates only. Retention (L-5): receipts 30 days unless feedback references them; feedback 12 months; a purge job in
   hms_services, never a trigger.
5. **Audit.** Each submission is audited (`assistant.feedback.submit`, detail: evaluation_id, rule_id, reason; no record
   values). Summary reads are audited as data access.
6. **Web.** On each finding in the assistant's claim result (and later the Records claim section): a "Report a problem"
   button opens the three reasons; under the answer, an optional helpful / partially / not helpful choice. Never asked
   after every message, never blocking. States are honest: "sending", "sent" only after the server's `201`, "not sent"
   with Try again on failure; no offline queue (it would need a storage, expiry and deletion design). Hidden without
   `assistant.feedback.submit`; in demo mode it explains that feedback is not sent. Submitting never changes the finding
   on screen.
7. **No automatic learning.** Nothing reads feedback to change a rule, a label or a result. Rule owners use the summary
   to open a proposal; a changed rule is a new rule-set version through the normal ADR-SVC-006 process (Phase B
   formalises proposals, triage and review routing: claim and coding rules go to the casemix/coding owner, labels to the
   workspace owner, L-8).

## Alternatives considered
1. **Look up the evaluation in `audit.audit_events`.** No new receipt table, but it needs a read grant on audit for the
   runtime role, which ADR-DB-002 deliberately withholds, and mixes audit evidence with analytics. Rejected.
2. **Signed evaluation token instead of a receipt.** The evaluation returns an HMAC over `evaluation_id`, user, rule
   results and expiry; feedback sends it back. Stateless and no new table for receipts, but it adds a signing key to
   manage and rotate, and the server still cannot answer "how many evaluations" for the denominator. Kept as the fallback
   if L-1 rejects receipts.
3. **Free-text comments.** Most useful for rule owners, but every comment would need PHI review, redaction and restricted
   access. Deferred until a reviewed redaction approach exists (L-3).
4. **Client-side analytics or a third-party feedback tool.** Sends hospital data outside the platform and bypasses
   authorization and audit. Rejected.
5. **Automatic rule tuning from feedback.** Forbidden by the governance skills; feedback is evidence, not authority.

## Consequences
- Positive: rule owners see which checks confuse or look wrong, per rule-set version, with a denominator; every item is
  traceable to an evaluation and an audit event.
- Negative: one extra write per evaluation (the receipt) and a new schema to operate.
- Operational: migration 0006, a bootstrap change (new group role), a purge job, two new permissions.
- Compatibility: assistant-v1 1.1.0 is additive; existing clients are unaffected.
- Security/privacy: no free text, no record values, no encounter number outside audit; feedback is scoped to the
  submitter's own evaluations and facility; summaries are aggregate-only with a minimum group size.
- Patient safety: feedback never changes what the assistant shows or how a claim is prepared.

## Owner decisions needed
- L-1: evaluation receipts (Decision 2) or signed tokens (Alternative 2).
- L-2: the reason list (`result_wrong`, `unclear`, `not_relevant`); any other reason.
- L-3: no free text in Phase A (confirm).
- L-4: who may submit (proposal: everyone with `assistant.rules.evaluate`) and who may read summaries (proposal: the
  casemix lead and the rule owners only).
- L-5: retention: receipts 30 days, feedback 12 months, feedback window 7 days after the evaluation.
- L-6: minimum group size in summaries (proposal: 5).
- L-7: a new `assistant` schema (proposal) or tables in an existing schema.
- L-8: who reviews feedback on claim rules (proposal: casemix/coding owner) and on labels (workspace owner).
- L-9: whether Phase A starts with the assistant panel only (proposal) or also the Records claim section.
- L-10: interaction telemetry (approved event taxonomy from the telemetry skill) now or in a later phase (proposal:
  later, after Phase A shows which questions matter).

## Migration and rollout
1. hms_database: bootstrap adds `hms_assistant_rw`; migration 0006 creates the schema, tables, view and grants; SQL tests
   for append-only, uniqueness, retention support and role access.
2. hms_services: receipts on evaluation; feedback and summary routes behind the new permissions (no role gets them by
   default); purge job; HTTP and PostgreSQL integration tests.
3. hms_workspace/web: feedback button and summary access behind the permissions; tests.
4. Rollback: remove the permissions from roles (the UI hides the button), or deploy the previous build; the tables stay
   and expire by retention.

## Acceptance criteria
- [ ] Owner decisions L-1 to L-10 recorded.
- [ ] assistant-v1 1.1.0 contract reviewed by the hms_workspace owner.
- [ ] Feedback for another user's evaluation, another facility, an unknown or expired evaluation, or a rule not in it is
      rejected and audited; nothing reveals whether the evaluation exists.
- [ ] Feedback rows and audit details contain no record values and no free text (tested).
- [ ] Repeat submission is idempotent; a changed reason is a new version.
- [ ] Summaries are aggregate-only, apply the minimum group size and return no user ids.
- [ ] No code path changes a rule, label or evaluation result from feedback (tested).
- [ ] Retention purge removes expired receipts and feedback and keeps audit events.
