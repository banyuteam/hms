---
name: hms-assistant-interaction-telemetry
description: Instrument HMS assistant interactions with minimal, privacy-aware, versioned events.
---
# HMS Assistant Interaction Telemetry

Use only an approved event taxonomy and capture meaningful milestones, not every click or keystroke. Suggested events: `conversation_started`, `user_turn_submitted`, `guided_flow_selected`, `guided_step_completed`, `assistant_response_presented`, `backend_evaluation_completed`, `user_feedback_submitted`, `expected_output_submitted`, `workflow_completed`, `workflow_abandoned`, `assistant_fallback_shown`, `assistant_correction_recorded`.

Events should include schema version, event ID, event type, client timestamp, conversation/session reference, flow ID/version and approved correlation reference. Backend derives actor identity from authenticated session. Client-provided actor, role, facility, authorization or action outcome is untrusted.

Do not capture raw message bodies by default, patient names, MRNs, diagnoses, notes, attachments or claim documents. Free-text feedback may contain PHI; redact/restrict/retain under approved policy. No PHI or high-cardinality IDs in metric labels.

Use existing authenticated API patterns. Bound payload and batch sizes. Retries require deduplication/idempotency. Telemetry must not block clinical workflows. Do not add a local persistence queue without security, expiry and deletion design.

Distinguish user-reported helpfulness from verified workflow completion. Closing a panel is not necessarily abandonment; a UI step is not proof of backend completion.

Test schema validation, redaction, deduplication, event ordering tolerance, payload limits and absence of PHI in logs.
