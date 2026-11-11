---
description: Apply human-centred design, clinical workflow analysis,
  clinical safety, accessibility, and interoperability practices when
  creating or changing clinician-facing HMS experiences.
name: clinical-ux-human-centered-design
---

# Clinical UX & Human-Centred Design

## Purpose

Design clinician-facing HMS experiences that support accurate, timely, safe clinical work while reducing cognitive burden and unnecessary interaction. Apply this skill to doctor, nurse, pharmacist, laboratory, radiology, and other clinical workflows, including screens, forms, dashboards, field components, and workflow interactions.

This skill improves the existing HMS experience; it does not authorize a wholesale redesign.

## 1. Mandatory project constraints

Before changing code, inspect the existing screen, components, project instructions, API contracts, and design tokens.

-   Preserve the existing Banyumanik 2 HMS branding, design tokens, typography, spacing, colors, navigation, reusable components, and working behavior.
-   Prefer incremental improvements and reusable components. Do not replace functioning screens merely to impose a new visual style.
-   Follow the existing React 19, strict TypeScript, and Vite architecture.
-   `hms_workspace` owns presentation and interaction, not clinical business rules, authorization, signatures, or persistence.
-   Never connect browser/mobile clients directly to PostgreSQL or legacy MySQL.
-   Do not invent clinical rules, dosage guidance, diagnostic criteria, reference ranges, terminology codes, or treatment recommendations.
-   Never use real patient information in fixtures, examples, screenshots, logs, or telemetry. Use synthetic data.
-   Do not silently change field meaning, clinical workflow states, resource mappings, or existing behavior.
-   If a proposed change conflicts with an established workflow, describe the conflict and propose a controlled migration.

## 2. Human-centred design process

Use the following process for meaningful clinical UX changes. Scale research effort to risk and scope; keep small visual fixes proportionate.

### A. Understand the clinical context

Identify:

1.  User roles and responsibilities.
2.  Care setting: outpatient, inpatient, emergency, operating room,
    pharmacy, laboratory, radiology, or other.
3.  User goal and task trigger.
4.  Preconditions: patient, encounter, status, orders, results, and
    permissions.
5.  Expected outcome: review, documentation, order, signature,
    finalization, or handoff.
6.  Consequences of omission, misunderstanding, duplication, or
    wrong-context entry.

Do not assume all clinicians or specialties follow the same workflow. Confirm differences against actual practice, facility policy, and role responsibilities.

### B. Map the real workflow

Document the main path, decisions, handoffs, waiting states, exceptions, corrections, cancellations, emergency paths, and completion state.

For each step, identify: - User action or decision. - Information required. - Data created, reviewed, or received. - Responsible role. - System response. - Failure and recovery path.

Keep three concepts distinct: - **Clinical process:** what should happen in care delivery. - **System process:** what the software requires. -
**Screen sequence:** how the interface presents the work.

Never force the clinical process to follow database tables or API boundaries.

### C. Identify needs and risks

Determine what information is needed, when it is needed, what must remain visible, and what can be deferred. Consider interruptions, time
pressure, shared workstations, wrong-patient/wrong-encounter hazards, duplicate entry, irreversible actions, accessibility, language, device, and connectivity constraints.

Prioritize risks by potential impact, likelihood, detectability, and recovery difficulty. Do not claim formal clinical risk assessment unless the appropriate process and reviewers have completed it.

### D. Design and prototype

-   Design around the task, not a collection of fields.
-   Keep the primary task and next action clear.
-   Group information by clinical meaning and workflow stage.
-   Keep patient and encounter identity visible for encounter-specific
    tasks.
-   Show the context needed to interpret values.
-   Use progressive disclosure for secondary information, never hiding
    critical safety context.
-   Use defaults only when safe, explainable, and policy-approved.
-   Make signing, finalization, prescribing, cancellation, and
    destructive actions explicit.
-   Support interruption, return, draft recovery, and safe continuation.
-   Reuse existing design-system components and tokens.
-   Design loading, empty, stale, error, validation, denied, saved, and
    finalized states.
-   Prototype complex or high-risk workflows before implementation.

### E. Validate with representative users

Where feasible, test with representative clinicians and operational
users using synthetic data and realistic tasks. Observe task
performance, not only preference.

Evaluate task completion, errors, time, unnecessary steps,
patient/encounter recognition, interpretation of source/time/status,
interruption recovery, keyboard operation, accessibility, and user
workload.

Record findings, severity, affected workflow, proposed change, and
retest result. Never fabricate user research or claim validation that
did not occur.

### F. Implement and monitor

Implement behind existing contracts, add tests, preserve current
workflows until verified, use controlled rollout for high-impact
changes, minimize PHI in telemetry, document material decisions, and
provide a rollback path.

## 3. Clinical workspace information architecture

Use an encounter-centred model for encounter-specific work. Do not force
every clinical screen into one navigation structure.

### Persistent patient and encounter context

Keep visible or immediately accessible as appropriate: - Approved
patient identifiers (never rely on name alone). - Encounter identifier,
type, date/time, and status. - Relevant age/sex information when
clinically appropriate. - Allergy and approved safety alerts. - Care
location or responsible unit where relevant.

Before high-impact actions, make the target patient, encounter, order,
or document explicit.

### Possible clinical task areas

Overview, Assessment, Diagnosis, Orders, Medication, Results, Clinical
Notes, History, and Documents. Show only what is relevant to the user's
role and workflow.

### Clinical overview

Prioritize current encounter status, relevant vital signs and
measurement times, active problems, allergies, current medications,
pending orders/results, and recent relevant notes. Separate current,
historical, pending, and completed information; avoid an
undifferentiated wall of data.

## 4. Clinical field specification

Every clinical field must have explicit meaning, type, lifecycle, and
provenance. Define a typed field specification with applicable
properties:

  -----------------------------------------------------------------------
  Property                            Meaning
  ----------------------------------- -----------------------------------
  `fieldId`                           Stable machine-readable identifier

  `label` / `helpText`                Visible label and supporting
                                      explanation

  `dataType`                          Text, coded concept, quantity,
                                      date/time, boolean, range, quantity
                                      pair, etc.

  `value`                             Current structured value

  `unit`                              Unit for quantitative values

  `referenceRange`                    Applicable range from an approved
                                      source

  `required`                          Requiredness for this workflow

  `readOnly`                          Editability in the current state

  `source`                            Origin of the value

  `observedAt`                        When the clinical observation
                                      occurred

  `recordedAt`                        When it was entered into the system

  `recordedBy`                        Practitioner or system identity

  `status`                            Draft, final, amended,
                                      entered-in-error, etc.

  `validation`                        Type, format, range, and workflow
                                      validation

  `terminology`                       Coding system and concept reference

  `resourceMapping`                   Intended clinical resource mapping

  `sensitivity`                       Sensitivity classification where
                                      needed
  -----------------------------------------------------------------------

Do not force every property onto every field. Use type-safe optional
properties and reusable field variants.

### Field presentation rules

-   Use visible, persistent labels; placeholders are not labels.
-   Show units clearly beside quantitative values.
-   Show reference ranges only when clinically applicable and sourced
    from an approved authority or facility configuration.
-   Distinguish observed time from recorded time.
-   Identify imported, calculated, copied-forward, and manually entered
    values when clinically relevant.
-   Clearly distinguish read-only, disabled, unavailable, and
    permission-restricted states.
-   Associate actionable validation messages with the relevant field.
-   Never use color as the sole status or severity indicator.
-   Requiredness must come from approved workflow/policy, not UI
    convenience.
-   Preserve clinically meaningful precision and units; do not silently
    round or convert.
-   Model compound values structurally, not as ambiguous free-text
    strings.

### Reusable semantic component patterns

Examples include `ClinicalTextField`, `ClinicalTextArea`,
`ClinicalQuantityField`, `ClinicalQuantityPairField`,
`ClinicalDateTimeField`, `ClinicalCodeSelector`,
`ClinicalDiagnosisSelector`, `ClinicalMedicationSelector`,
`ClinicalObservationDisplay`, `ClinicalResultDisplay`,
`ClinicalAllergySummary`, `ClinicalProvenance`, `ClinicalStatus`, and
`ClinicalFieldHistory`.

These are semantic patterns, not permission to create a parallel design
system. Build them from the existing HMS design-system primitives.

## 5. Clinical semantics and interoperability

Interoperability mapping preserves meaning; it does not dictate screen
layout.

  Concept                           Common HL7 FHIR resource
  --------------------------------- ----------------------------
  Patient                           `Patient`
  Encounter                         `Encounter`
  Practitioner                      `Practitioner`
  Practitioner role                 `PractitionerRole`
  Vital signs / measured findings   `Observation`
  Diagnosis / problem               `Condition`
  Allergy / intolerance             `AllergyIntolerance`
  Medication order                  `MedicationRequest`
  Medication administration         `MedicationAdministration`
  Procedure request                 `ServiceRequest`
  Diagnostic report                 `DiagnosticReport`
  Clinical assessment               `ClinicalImpression`
  Clinical document composition     `Composition`
  Document reference                `DocumentReference`

Important distinctions: - `Observation` generally represents a
measurement or finding; `Condition` represents a condition or problem. -
An allergy is not merely free text or a generic diagnosis. - A
medication request does not prove dispensing or administration. - A
procedure request does not prove that a procedure occurred. - A
narrative note and a structured observation are not interchangeable. -
An encounter is not the same as a longitudinal patient record.

Use relevant terminology systems such as SNOMED CT, LOINC, ICD-10,
ICD-9-CM, and approved Indonesian catalogues only when appropriate to
the domain. Confirm version, licensing, national profile, and
facility-approved catalogue. For Indonesia-specific interoperability,
verify current SATUSEHAT FHIR guidance and applicable Ministry of Health
requirements.

Never invent a code, code-system URI, terminology version, or mapping.
Mark unresolved mappings for clinical/integration review.

## 6. Lifecycle and provenance

The interface must reflect the backend lifecycle; do not invent
client-only states that imply persistence or finality.

Possible states include `draft`, `pending_review`, `final`, `amended`,
`entered_in_error`, `cancelled`, and `unknown`. The authoritative state
model must be agreed with `hms_services` and `hms_database`.

-   Clearly distinguish draft from finalized data.
-   Finalized data is not editable unless an explicit backend amendment
    workflow allows it.
-   Preserve prior values and provenance for amendments according to
    policy.
-   Never silently overwrite a clinically significant value.
-   Distinguish save, sign, finalize, amend, cancel, and delete.
-   A UI interaction is not proof that the backend committed the
    transaction.
-   Show server-confirmed state; handle delayed, failed, and ambiguous
    responses honestly.
-   Display who recorded/amended a value and when where required.

## 7. Clinical safety and interaction

### Patient and encounter safety

Maintain clear patient/encounter context during entry. Prevent
accidental submission to a different patient or encounter after context
changes. Preserve entered work where supported, but never submit it to a
new context automatically. Do not infer a target patient from a previous
screen or conversation.

### High-impact actions

For signing, finalizing, prescribing, discontinuing, ordering, or
closing an encounter: - State the action and consequence clearly. - Show
the target and relevant summary. - Require explicit user intent. - Rely
on backend authorization and workflow validation. - Prevent duplicate
submissions through appropriate request/idempotency contracts. - Show
server-confirmed outcome. - Provide a safe correction/amendment path
where policy allows.

### Alerts

Distinguish blocking errors, warnings, informational messages, and
advisory content. Prioritize actionable alerts and avoid
duplicate/low-value messages that contribute to alert fatigue. Explain
why an alert appears and what action is available. Never suppress or
downgrade a safety alert merely to simplify the UI. Alert rules and
severity are governed by approved clinical/backend policy, not
improvised in React.

### Save and interruption

Make save behavior explicit. If autosave exists, show
saving/saved/failed states. Autosave is not signature or finalization.
Preserve drafts across navigation/interruption when supported. Handle
concurrent edits and stale versions through explicit server contracts;
never silently choose a winner.

## 8. Accessibility and human factors

Use WCAG 2.2 AA as the default web target unless project policy requires
stricter criteria.

-   All controls are keyboard operable with visible, logical focus.
-   Every input has a programmatic label.
-   Errors and status changes are perceivable to assistive technology.
-   Meaning is not communicated by color alone.
-   Contrast and target sizes are usable.
-   Zoom and responsive layouts do not hide essential information.
-   Use semantic headings, landmarks, buttons, and form controls.
-   Dialogs and overlays manage focus correctly.
-   Use plain, unambiguous language and consistent terminology.
-   Safely handle session expiry and time limits without silently losing
    work.

Consider interruptions, time pressure, shared workstations,
keyboard-heavy use, varied screen sizes, gloves/touch where applicable,
and low-connectivity environments.

## 9. Role-aware UX and authorization

The UI may adapt to role and workflow, but it is never the authorization
authority.

-   Render capabilities using server-provided permissions and workflow
    context.
-   Hidden buttons and disabled fields are presentation only.
-   Backend authorization is required for every read and write.
-   Permission evaluation may consider identity, professional role,
    facility, department, encounter relationship, resource sensitivity,
    action, and workflow state.
-   Distinguish view, create, update, sign/finalize, amend, and
    administer where required.
-   Do not assume a doctor can access every patient or resource.
-   Emergency/break-glass access follows backend policy, explicit
    intent, reason capture, audit, and review.

When permissions are missing or uncertain, fail safely. Never silently
grant access.

## 10. Frontend and declarative UI architecture

-   Build semantic clinical components on existing design-system
    primitives.
-   Separate clinical field metadata from visual implementation.
-   Use TypeScript discriminated unions for field/component variants.
-   Keep components composable, testable, and consistent across modules.
-   Keep layout definitions separate from clinical data and
    authorization.
-   Model loading, empty, stale, error, unauthorized, draft, and
    finalized states explicitly.
-   Validate API response shapes and render safely.
-   Avoid unnecessary PHI in global state, browser storage, URLs, logs,
    and telemetry.
-   Clear or revalidate sensitive state when session or authorized
    context changes.

### Python DSL and UI IR

When using the Python DSL: - Python is trusted authoring/build-time
only. - Compile to typed, versioned declarative UI IR. - IR must not
contain executable Python/JavaScript, arbitrary HTML/CSS/SQL, imports,
or arbitrary function names. - React renders allowlisted components
through the existing design system. - Go services remain authoritative
for authorization, validation, resource resolution, actions, and
persistence. - Data source and action IDs resolve only to registered
backend handlers. - Reauthorize every resource and action on the
backend. - Validate component/property schemas, tree depth/node count,
bindings, action IDs, and contract version before publication. -
Published versions are immutable and support controlled rollback. -
Assistant-generated UI is an untrusted proposal and follows the same
validation, review, and publication process as human-authored UI.

## 11. Testing and definition of done

Test at the appropriate level:

1.  Component: labels, units, validation, read-only states, keyboard
    behavior, status.
2.  Contract: request/response types, resource references, versions,
    error handling.
3.  Workflow: end-to-end tasks, interruption, draft recovery, stale
    data, transitions.
4.  Authorization: allowed/denied roles, facilities, encounters,
    resources, actions.
5.  Safety: wrong-patient and wrong-encounter prevention, duplicate
    submission, finalization safeguards.
6.  Accessibility: keyboard, focus, labels, contrast,
    assistive-technology semantics.
7.  Regression: existing screens, navigation, tokens, and workflows.

A substantial change is done only when: - User, setting, task, and
workflow are identified. - Clinical meaning and data ownership are
documented. - Risks and edge cases are addressed. - Existing
design-system conventions are preserved. - Patient/encounter context is
unambiguous where relevant. - Field types, units, provenance, and
lifecycle are explicit. - Backend authorization and validation remain
authoritative. - Loading, empty, stale, error, denied, and success
states are handled. - Accessibility and relevant automated tests pass. -
Clinical review/user validation is recorded when required by risk. -
Recovery or rollback is available for high-impact changes.

## 12. Required deliverable for substantial tasks

Before implementation, provide a concise proposal containing:

1.  Clinical context: role, setting, task, encounter scope.
2.  Current-state assessment: screens, components, workflows,
    constraints.
3.  Workflow map: main path, handoffs, exceptions, completion state.
4.  UX proposal: hierarchy, navigation, fields, interactions.
5.  Clinical data mapping: resources and terminology; unresolved
    mappings.
6.  Safety/accessibility: risks and safeguards.
7.  Implementation plan: components, files, contracts, state, migration.
8.  Verification plan: tests, reviewers, acceptance criteria.

For small low-risk changes, keep the process proportionate and proceed
directly while preserving constraints.

## 13. Standards and source hierarchy

Verify current versions and applicability before making compliance
claims. Prefer: 1. Applicable Indonesian laws, Ministry of Health
requirements, and current SATUSEHAT guidance. 2. Hospital-approved
clinical policies, workflows, and terminology catalogues. 3. Official
HL7 FHIR specifications and implementation guides. 4. Official SNOMED CT
and LOINC documentation, subject to licensing and local adoption. 5. W3C
WCAG 2.2 and WAI form guidance. 6. ISO 9241-210 human-centred design
guidance. 7. ISO 14971 where medical-device software applicability is
established. 8. Peer-reviewed human-factors and clinical informatics
evidence.

Following this skill alone does not establish regulatory compliance,
clinical safety certification, or conformance to a standard.
Applicability depends on intended use, product, jurisdiction, and
deployment.

## 14. Design review checklist

-   [ ] User, clinical setting, and task are explicit.
-   [ ] Screen follows the real workflow, not database structure.
-   [ ] Active patient and encounter are unambiguous.
-   [ ] Critical safety context is visible when needed.
-   [ ] Fields are grouped by clinical meaning.
-   [ ] Labels, units, timestamps, source, and provenance are clear.
-   [ ] Measurements are distinguished from diagnoses and narrative
    notes.
-   [ ] Draft, final, amended, and error states are distinguishable.
-   [ ] High-impact actions are explicit and protected.
-   [ ] Interruption and failure recovery are safe.
-   [ ] Role capabilities are backed by server authorization.
-   [ ] Existing HMS tokens and components are reused.
-   [ ] Keyboard accessibility and WCAG 2.2 AA have been
    considered/tested.
-   [ ] PHI exposure and telemetry are minimized.
-   [ ] Representative workflows and regression tests are verified.
