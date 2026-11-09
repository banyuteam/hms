# Schema `clinical`

- Migrations: `0011` (encounters, conditions, allergies), `0012` (observations, procedures, diagnostic reports),
  `0013` (medication), `0015` (documents, signatures, provenance); `0017` adds `diagnostic_reports.imaging_study_id`
- Writer: `hms_services` clinical modules (`hms_clinical_rw`)
- Readers: `hms_services` only
- Classification: restricted (health data)
- Design: [ADR-DB-004](../../documentation/adr/ADR-DB-004-clinical-data-foundation.md),
  [ADR-DB-005](../../documentation/adr/ADR-DB-005-clinical-record-integrity.md)

## Resources
| FHIR R4 | Tables |
|---|---|
| Encounter | `encounters`, `encounter_status_history`, `encounter_participants`, `encounter_locations`, `encounter_diagnoses` |
| Condition | `conditions` (problem-list item or encounter diagnosis) |
| AllergyIntolerance | `allergy_intolerances`, `allergy_reactions` |
| Observation | `observations` (panels via `parent_observation_id`), `observation_components` |
| Procedure | `procedures`, `procedure_performers` |
| DiagnosticReport | `diagnostic_reports`, `diagnostic_report_results` |
| Medication* | `medications`, `medication_ingredients` (racikan), `medication_requests`, `medication_dispenses`, `medication_administrations`, `medication_statements` |
| Composition | `compositions`, `composition_authors`, `composition_sections`, `composition_section_entries`, `composition_attestations` |
| Provenance | `provenances`, `provenance_agents`, `provenance_entities` |
| (signature) | `signatures` |

## Rules
- **Status columns:** FHIR R4 required codes (CHECK). Row-local invariants are enforced: con-3/4/5 (conditions),
  ait-1/2 (allergies), obs-6 (observations), plus one value[x] per observation and component.
- **Coded values:** `*_system`, `*_code`, `*_display`; the system must be registered in `terminology.code_systems`.
  Free text sits beside the code (`code_text`) when no code applies. Numbers are NUMERIC. Units are the human unit
  plus a UCUM code when coded.
- **Same patient, same tenant:** composite foreign keys `(encounter_id, patient_id)`,
  `(practitioner_id, organization_id)` and so on make a record's encounter, condition, request, panel, report or
  study belong to the same patient and organization. Document entries are polymorphic and checked by trigger.
- **Versioned and append-only tables:**
  - Every resource table (except signatures, attestations and provenance) is a versioned record: history is in
    `clinical.resource_versions`, there are no deletes, entered-in-error is terminal, and finalized statuses change
    only with `hms.change_reason` (list in ADR-DB-005).
  - Child rows bump their parent, so a finalized document's sections cannot change unnoticed.
  - Attestations and provenance are append-only.
  - Signatures are append-only except their verification fields.
- **Documents:** a composition may carry openEHR structured `content` (at most 1 MiB). This requires an *active*
  `knowledge.templates` version and a `content_format`. Section narrative is stored as written.
- **Attestation and signatures:**
  - An attestation names the exact composition version. That version must be final or amended in history.
  - A signature must cover exactly that version, and be made by the practitioner's own linked, active user.
  - Signature bytes and rendered PDFs live in object storage (`*_ref` plus SHA-256). No private keys are stored
    here.
- **Times:** instants are `timestamptz` (UTC). Render them in the facility's `timezone`. `recorded_at`/`issued_at`
  are clinical times; recording time is in `resource_versions.recorded_at`.

## Typical queries
```sql
-- Vital signs of a patient, newest first (context set: hms.organization_id)
SELECT o.code, o.effective_at, c.code AS component, c.value_quantity, c.value_unit_code
FROM clinical.observations o LEFT JOIN clinical.observation_components c ON c.observation_id = o.id AND c.active
WHERE o.patient_id = $1 AND o.category_code = 'vital-signs' AND o.status IN ('final', 'amended', 'corrected')
ORDER BY o.effective_at DESC LIMIT 50;

-- FHIR vread / _history
SELECT version, recorded_at, actor_user_id, change_reason, snapshot
FROM clinical.resource_versions WHERE resource_type = 'Observation' AND resource_id = $1 ORDER BY version;
```

## Not decided yet
- Orders (ServiceRequest), specimens, care plans, family history and immunizations.
- Department (Organization) references.
- FHIR XHTML narrative.
