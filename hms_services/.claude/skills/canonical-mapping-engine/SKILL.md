---
name: canonical-mapping-engine
description: >
  Implements deterministic mappings from legacy/external representations into canonical HMS models and events.
---


# Canonical Mapping Engine
Mappings are explicit, versioned and testable. Preserve source IDs/provenance. Separate normalization from business interpretation. Represent unknown, invalid and ambiguous values explicitly. Do not infer clinical meaning from field names. Distinguish observed state from verified domain fact.

Workflow: source schema/version -> canonical target -> document semantics/confidence -> type/code/unit/status conversion -> null/default behavior -> validation/rejection -> golden tests -> version and reconcile unmapped records.
