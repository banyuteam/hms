# ADR-SVC-008: Assistant feedback and learning loop — structured feedback on claim findings first

- Status: Accepted 2026-11-09 (owner decisions L-1 to L-10 below); L-11 (telemetry retention) open. Not implemented.
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
- Findings carry codes and field paths, never record values (ADR-SVC-006 Decision 7). Feedback must keep that property
  everywhere except the optional comment, which is treated as patient data (Decision 5).
- Learning must never change rules, catalogues or authorization on its own (governance skill): it produces evidence and
  proposals; a new rule-set version is still a code change, reviewed and released as today.

## Decision
Phase A: capture structured feedback and a small set of interaction events, and report deterministic aggregates.
Observations and proposals (Phase B) and evaluation datasets and release gates (Phase C) get their own ADRs once
Phase A has data.

1. **What can be reported.** Two optional kinds, both about a claim-readiness evaluation the same person ran:
   - **Finding feedback:** `rule_id`, the `result` they saw, and one reason (L-2): `result_wrong` (the record says
     otherwise), `unclear` (the label or explanation is hard to understand), `not_relevant` (this check does not apply
     to this visit), `data_outdated` (the record was corrected in the legacy HMS after the check).
   - **Answer feedback** (learning-UX skill): `helpful`, `partially_helpful` or `not_helpful`, and for the last two an
     optional expected-output category: `more_specific`, `different_interpretation`, `actionable_steps`,
     `additional_information`, `other`.

   Either may carry an **optional comment** of at most 200 characters (L-3). The UI says not to enter patient details,
   but the comment is stored and handled as patient data regardless (Decision 5).
2. **Evaluation receipt (L-1).** When an evaluation is returned, the service also writes a receipt: `evaluation_id`,
   actor user id, organization and facility, rule set id and version, `evaluated_at`, and each `rule_id` with its
   result. No encounter number and no record values: the audit event already links the evaluation to the encounter for
   authorized reviewers. Feedback must reference a receipt of the same user and facility, for a rule in it, with the
   result it recorded, within 7 days of `evaluated_at` (L-5). Receipts also give summaries their denominator (how many
   evaluations ran). If the receipt cannot be written, the evaluation is still returned (the audit event is the record
   that matters); feedback on it is then refused as "not found".
3. **API (assistant-v1 1.1.0, additive).** All routes: session required, same Origin and JSON checks as other
   state-changing requests, bounded bodies, unknown fields rejected, per-user rate limits, errors in the `httpx` envelope.
   - `POST /api/v1/assistant/feedback`: `{evaluation_id, rule_id, reason, comment?}` for a finding, or
     `{evaluation_id, helpfulness, expected?, comment?}` for the answer. Body at most 1 KiB. Requires
     `assistant.rules.evaluate` (L-4: whoever may run claim checks may report on them; no separate grant). Idempotent:
     one current item per user, evaluation and target (finding or answer); a repeat with the same content returns the
     stored item, a change is stored as a new version. `201 {feedback_id}`; `404` for an unknown, foreign or expired
     receipt (no detail about which); `422` for a rule that was not in the evaluation or a result that differs.
   - `GET /api/v1/assistant/feedback/summary?rule_set=claim-readiness&version=&from=&to=`: counts per rule, result and
     reason, helpfulness counts, number of comments (never their text), and the number of evaluations in the window.
     Requires `assistant.feedback.review` (L-4). Groups with fewer than 5 items show as "fewer than 5" (L-6); no user ids.
   - `GET /api/v1/assistant/feedback/comments?rule_set=&version=&rule_id=&from=&to=` (paginated): comment text with
     rule, reason and date, never the submitter. Requires `assistant.feedback.comments.read` (L-3b); every read is
     audited with the filter used.
   - `POST /api/v1/assistant/events`: interaction events (Decision 6), a batch of at most 20, body at most 4 KiB.
     Requires a session only; events from a session without `assistant.rules.evaluate` are accepted but carry no claim
     topic. `202`; duplicates by `event_id` are ignored.

   No role receives `assistant.feedback.review` or `assistant.feedback.comments.read` by default; the owner grants them
   in User & Access to the casemix lead and named rule owners.
4. **Persistence (hms_database, migration `0006`, L-7).** A new schema `assistant` owned by `hms_meta_owner`, written
   through a new group role `hms_assistant_rw` (added to `bootstrap.psql` first, granted to `hms_meta_runtime`):
   - `assistant.evaluation_receipts` (append-only).
   - `assistant.feedback` (append-only versions; unique current item per user, evaluation and target).
   - `assistant.feedback_comments` (separate table so it can have its own retention and stricter access; references
     the feedback version).
   - `assistant.interaction_events` (append-only, deduplicated by `event_id`).
   - A reporting view with aggregates only, readable through `hms_report_read`; no reporting access to comments.
5. **Retention and handling (L-5).** Receipts 30 days unless feedback references them; feedback choices 12 months;
   comments 90 days, then deleted while the choice stays; interaction events: L-11. A purge job in hms_services deletes
   expired rows in bounded batches; never a trigger. Audit events follow the audit policy and are not purged here.
   Comments never appear in logs, traces, metrics, audit details or summaries.
6. **Interaction telemetry (L-10).** A small, versioned event set, recorded only for the assistant panel:
   - `topic_selected`: `topic` (one of the six topic ids) and `input` (`button` or `typed`).
   - `fallback_shown`: `kind` (`help`, `need_tag`, `need_visit`, `choose_visit`, `not_loaded`, `refused`).

   Every event carries `schema_version`, `event_id` (client-generated, for deduplication only), `type`, client
   timestamp and `panel_session` (a random id created when the panel is first opened after sign-in, kept in memory, never
   an identity). The server derives user, organization and facility from the session and records its own receive time.
   Events never carry typed text, encounter or patient identifiers, tags or record values. "Claim check completed" is not
   a client event: the server knows it from the receipts. Telemetry is fire-and-forget: it never blocks or slows the
   panel, failures are dropped (no retry queue, no local storage).
7. **Audit.** Each feedback submission is audited (`assistant.feedback.submit`, detail: evaluation_id, target, reason or
   helpfulness, whether a comment was given; never the comment). Summary and comment reads are audited as data access.
   Interaction events are not audited individually.
8. **Web (L-9).** In the assistant panel only for Phase A:
   - On each finding of the claim result: "Report a problem" opens the four reasons and the optional comment.
   - Under the claim answer: an optional helpful / partially / not helpful choice, then the optional expected category.
   - Never asked after every message, never blocking. Honest states: "sending", "sent" only after the server's `201`,
     "not sent" with Try again on failure; no offline queue. Demo mode explains that feedback is not sent.
   - Submitting never changes the finding on screen. The Records claim section follows in a later slice, after it uses the
     same grouped view.
9. **Review and no automatic learning (L-8).** Nothing reads feedback or events to change a rule, a label or a result.
   Feedback on claim and coding rules (`result_wrong`, `not_relevant`, `data_outdated`) is reviewed by the casemix/coding
   owner; feedback on wording (`unclear`, answer helpfulness) by the workspace/product owner. Either may open a proposal;
   a changed rule is a new rule-set version through the normal ADR-SVC-006 process (Phase B formalises proposals).

## Alternatives considered
1. **Look up the evaluation in `audit.audit_events`.** No new receipt table, but it needs a read grant on audit for the
   runtime role, which ADR-DB-002 deliberately withholds, and mixes audit evidence with analytics. Rejected.
2. **Signed evaluation token instead of a receipt.** Stateless, but adds a signing key to manage and rotate, and gives no
   denominator. Rejected (L-1).
3. **No free text.** Lowest risk, but rule owners lose the "why". Rejected in favour of a short, restricted,
   short-lived comment (L-3).
4. **Client-side analytics or a third-party feedback tool.** Sends hospital data outside the platform and bypasses
   authorization and audit. Rejected.
5. **Automatic rule tuning from feedback.** Forbidden by the governance skills; feedback is evidence, not authority.

## Consequences
- Positive: rule owners see which checks confuse or look wrong, per rule-set version, with a denominator, and why in
  the submitter's words; every item is traceable to an evaluation and an audit event.
- Negative: one extra write per evaluation (the receipt); a new schema, a purge job and patient-data handling for
  comments.
- Operational: bootstrap change (new group role), migration 0006, purge job, two new permissions
  (`assistant.feedback.review`, `assistant.feedback.comments.read`).
- Compatibility: assistant-v1 1.1.0 is additive; existing clients are unaffected.
- Security/privacy: no record values or encounter numbers in feedback, events or summaries; comments are restricted to a
  separate permission, audited on every read, deleted after 90 days and never logged; feedback is scoped to the
  submitter's own evaluations and facility; summaries apply a minimum group size of 5.
- Patient safety: feedback and events never change what the assistant shows or how a claim is prepared.

## Owner decisions (2026-11-09)
- L-1: evaluation receipts (not signed tokens).
- L-2: finding reasons `result_wrong`, `unclear`, `not_relevant`, `data_outdated`.
- L-3: optional comment of at most 200 characters, treated as patient data. L-3b: comments readable only with the
  separate permission `assistant.feedback.comments.read`, every read audited.
- L-4: whoever may run claim checks (`assistant.rules.evaluate`) may send feedback; summaries need
  `assistant.feedback.review` (casemix lead and rule owners).
- L-5: receipts 30 days, choices 12 months, comments 90 days, feedback accepted up to 7 days after the check.
- L-6: minimum group size 5 in summaries.
- L-7: new `assistant` schema with group role `hms_assistant_rw`.
- L-8: claim/coding feedback to the casemix/coding owner; wording feedback to the workspace/product owner.
- L-9: Phase A UI in the assistant panel only.
- L-10: interaction telemetry in Phase A, limited to the event set of Decision 6.

## Open
- L-11: retention of `interaction_events` (proposal: 90 days, with monthly aggregates kept 12 months).

## Migration and rollout
1. hms_database: bootstrap adds `hms_assistant_rw`; migration 0006 creates the schema, tables, view and grants; SQL tests
   for append-only, uniqueness, deduplication, role access (runtime writes, reporting reads aggregates only, no
   reporting access to comments) and retention support.
2. hms_services: receipts on evaluation; feedback, summary, comments and events routes; permissions registered (no role
   gets the review permissions by default); purge job; HTTP and PostgreSQL integration tests.
3. hms_workspace/web: feedback controls and telemetry in the assistant panel; tests.
4. Rollback: remove the permissions from roles (the UI hides feedback), or deploy the previous build; the tables stay
   and expire by retention.

## Acceptance criteria
- [x] Owner decisions L-1 to L-10 recorded.
- [ ] L-11 decided.
- [ ] assistant-v1 1.1.0 contract reviewed by the hms_workspace owner.
- [ ] Feedback for another user's evaluation, another facility, an unknown or expired evaluation, or a rule not in it is
      rejected and audited; nothing reveals whether the evaluation exists.
- [ ] Feedback rows, events and audit details contain no record values and no encounter or patient identifiers; comment
      text appears only in `feedback_comments` and the comments route (tested, including logs).
- [ ] Repeat submission is idempotent; a changed item is a new version; duplicate events are ignored.
- [ ] Summaries are aggregate-only, apply the minimum group size, count comments without showing them and return no
      user ids.
- [ ] Comment reads require `assistant.feedback.comments.read` and are audited.
- [ ] No code path changes a rule, label or evaluation result from feedback or events (tested).
- [ ] Telemetry failures never block or slow the panel (tested).
- [ ] Retention purge removes expired receipts, comments, feedback and events, and keeps audit events.
