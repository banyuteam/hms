---
name: hms-assistant-learning-ux
description: Build feedback, expected-output capture and learning-aware UX for the deterministic HMS assistant.
---
# HMS Assistant Learning UX

## Mission and ownership
Implement only user-facing feedback, expected-output capture, client state and API integration in `hms_workspace`. Backend analysis, authorization and persistence belong to `hms_services` and `hms_database`.

## Preserve the existing product
Preserve RS Banyumanik 2 branding, design tokens, AppShell, navigation, workflow tabs and current assistant behavior. Extend incrementally; reuse components. Do not replace the assistant or create a parallel panel without explicit approval.

## Feedback UX
Offer optional feedback at sensible points, not after every message. Support helpful / partially helpful / not helpful. When appropriate, ask what was expected: more specific answer, different interpretation, actionable steps, additional information or other. Keep free text optional and concise. Feedback must never block a clinical workflow.

## Event capture
Use approved versioned event DTOs. Capture only meaningful events. Client event IDs may aid deduplication but are not identity or authorization proof. Never log full clinical notes or patient records. Do not infer assistant context from active tab, route or current patient. Backend authorizes resource references independently.

## Honest states
Distinguish locally queued, backend accepted, failed and unavailable states. Do not claim feedback was saved until confirmed. Offline queuing requires an approved secure storage, expiry and deletion design.

## Insights UI
Administrative insights require backend authorization. Show aggregation windows, sample sizes and metric definitions. Distinguish observations from approved changes. Do not expose raw patient conversations by default.

## Tests
Test optionality, accessibility, duplicate submission, API failure, offline behavior if supported, PHI redaction, context switching and preservation of existing workflows.
