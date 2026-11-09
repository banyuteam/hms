---
name: hms-assistant-learning-data
description: Govern PostgreSQL persistence for assistant interaction evidence, feedback, observations, evaluation and releases.
---
# HMS Assistant Learning Data

`hms_database` owns schema, migrations, constraints, indexes, data dictionary and retention-supporting structures. Go owns runtime access; clients never connect directly to PostgreSQL.

Before adding tables, inspect existing schema ownership and reuse appropriate audit/eventing/workflow/configuration structures. Confirm purpose, data class, PHI status, access and retention. Do not automatically create an `assistant_learning` schema.

Potential logical entities: interaction session metadata, interaction event, user feedback, expected-output category, verified workflow outcome, intent classification, learning observation, improvement proposal, evaluation dataset/case, evaluation run/result and approved release reference. These are concepts, not mandatory table names.

Prefer metadata and opaque references over raw conversation content. Do not persist full patient records as learning data. Free text may contain PHI and needs minimization, redaction, restricted access and retention. Keep aggregates separate from source evidence with lineage.

Preserve event schema version, flow/rule/template version, catalogue release, analysis version, evaluation dataset version and approval/publication references. Published versions are immutable by application policy and database safeguards where practical.

Define retention by purpose and data class. Use least-privilege roles. Support expiry/deletion under approved policy while retaining legally required audit evidence. Index measured query patterns; avoid sensitive high-cardinality indexes without justification. Do not store high-volume metrics/logs/traces indefinitely in PostgreSQL.

Use repository migration conventions. Test constraints, idempotency, roles, retention, referential integrity, version immutability and representative aggregation queries.
