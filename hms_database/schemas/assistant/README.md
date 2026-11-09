# Schema `assistant`

- Migration: `0006_assistant_feedback.sql`
- Decision: `hms_services/documentation/architecture/ADR-SVC-008-assistant-feedback-and-learning.md` (owner decisions
  L-1 to L-11, 2026-11-09)
- Writer: `hms_services` assistant module (`hms_assistant_rw`)
- Readers: `hms_services`; reporting reads the two aggregate views only (`hms_report_read`)
- Classification: confidential (staff ids, rule codes and results; no record values, no encounter or patient
  identifiers). `feedback_comments` is **restricted**: free text that may contain patient data.
- Nothing here decides an evaluation result: rules stay in hms_services code and change only by a new rule-set version.

## Tables

| Table | Grain | Rules |
|---|---|---|
| `evaluation_receipts` | one claim-readiness evaluation returned to a user | append-only; no encounter (the audit event links it) |
| `evaluation_receipt_results` | one rule result of a receipt | append-only; removed with its receipt |
| `feedback` | one version of one user's feedback on a finding or the answer | append-only versions; only `superseded_at` changes, once |
| `feedback_comments` | the optional comment of one feedback version | 1 to 200 characters; not editable |
| `interaction_events` | one usage event (`topic_selected`, `fallback_shown`) | schema v1; deduplicated per user by `event_id` |
| `monthly_counts` | one month × facility × metric × dimensions | evaluations, topic selections, fallbacks; only `total` changes |

The database enforces lineage with composite foreign keys:
- `feedback (evaluation_id, user_id)` → `evaluation_receipts`: feedback only on the user's own evaluation.
- `feedback (evaluation_id, rule_id, result_seen)` → `evaluation_receipt_results`: a finding must name a rule of that
  evaluation with the result it had.

The 7-day feedback window (L-5) is checked by hms_services, not here, because it depends on the current time.

## Usage

Record an evaluation (same request as the claim-readiness evaluation, after the audit event):
```sql
INSERT INTO assistant.evaluation_receipts (evaluation_id, organization_id, facility_id, user_id, rule_set_id,
                                           rule_set_version, evaluated_at) VALUES ($1, $2, $3, $4, $5, $6, $7);
INSERT INTO assistant.evaluation_receipt_results (evaluation_id, rule_id, result)
SELECT $1, r.rule_id, r.result FROM unnest($8::text[], $9::text[]) AS r(rule_id, result);
```

Change a feedback item (one transaction): supersede the current version, insert the next one.
```sql
UPDATE assistant.feedback SET superseded_at = now()
WHERE evaluation_id = $1 AND user_id = $2 AND target = $3 AND rule_id IS NOT DISTINCT FROM $4 AND superseded_at IS NULL
RETURNING version;
INSERT INTO assistant.feedback (evaluation_id, user_id, target, rule_id, result_seen, reason, helpfulness, expected, version)
VALUES (..., $previous_version + 1);
```
`uq_feedback_current` makes two concurrent first submissions fail with 23505 instead of creating two current items.

Interaction events:
```sql
INSERT INTO assistant.interaction_events (...) VALUES (...) ON CONFLICT DO NOTHING;   -- 0 rows: duplicate
```

Monthly counts (before raw rows expire):
```sql
INSERT INTO assistant.monthly_counts (month, organization_id, facility_id, metric, rule_set_id, rule_set_version,
                                      topic, input, fallback_kind, total)
VALUES (...)
ON CONFLICT (month, organization_id, facility_id, metric, rule_set_id, rule_set_version, topic, input, fallback_kind)
DO UPDATE SET total = EXCLUDED.total;   -- recompute a month from its rows, never add twice
```

## Retention (L-5, L-11), run by the hms_services purge job in bounded batches
| Data | Kept | Note |
|---|---|---|
| `evaluation_receipts` (+ results) | 30 days | a receipt referenced by feedback cannot be deleted (FK) and stays until its feedback expires |
| `feedback` | 12 months | deleting a version deletes its comment |
| `feedback_comments` | 90 days | deleted on their own; the feedback choice stays |
| `interaction_events` | 90 days | counted into `monthly_counts` first |
| `monthly_counts` | 12 months | no user ids |

Audit events are kept under the audit policy and are never purged by this job.

## Aggregate views (`hms_report_read`)
- `feedback_summary_monthly`: current feedback per month, facility, rule-set version, rule, result and choice, with
  `feedback_count` and `comment_count`.
- `usage_summary_monthly`: `monthly_counts` per month, facility and metric.

Groups below 5 show `NULL` counts and `suppressed = true` (L-6). The views run with the owner's rights, so reporting
has no access to the rows; no view exposes user ids, evaluation ids, panel sessions or comment text.
