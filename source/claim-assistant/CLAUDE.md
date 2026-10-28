# claim-assistant — Instructions

Helps the insurance claim team reconcile patients' medical records with BPJS claim outcomes:
explain pending/rejected claims, check diagnosis and procedure coding against INA-CBG
(E-Klaim) grouping, and maintain the ICD-10 / ICD-9-CM catalogue. Read the root `CLAUDE.md`
and this folder's `PRD.md` first.

## Scope

- **Catalogue**: ICD-10 and ICD-9-CM code tables in the editions INA-CBG accepts, with
  versioning, Indonesian/English descriptions, and validity flags (e.g. codes not allowed as
  primary diagnosis). Import from official sources only; record source and version.
- **Claim reconciliation**: link each claim (No. SEP, `no_rawat`) to the medical record
  (diagnoses, procedures, LOS, care class, discharge status, supporting results) and to the
  E-Klaim result (CBG code, tariff, status, verifier notes).
- **Pending/rejection analysis**: classify reasons (coding mismatch, missing supporting
  evidence, administrative data, duplicate/readmission rules, etc.) and show the evidence
  behind each finding.
- **Coding check**: flag diagnosis/procedure combinations likely to group differently or be
  questioned, and suggest what the coder should review.
- UI screens are built as a module in `source/web-frontend/` unless the PRD says otherwise.

## Rules

- Follow `source/backend-services/` conventions. Data comes from domain events and read models —
  not from direct Khanza queries.
- The assistant **suggests**; a certified coder decides. Never auto-change a diagnosis,
  procedure or claim. Every suggestion shows its rule/evidence and is logged with the
  coder's decision.
- Rules live as data/config with tests (one test per rule, synthetic cases), each citing the
  regulation or BPJS/Kemenkes guideline it comes from (record the document and version).
  Ask the user when a rule's source is unclear — don't invent coding rules.
- Calls to BPJS VClaim and E-Klaim follow their official specs (signatures, encryption,
  timestamps); credentials from the secret store; respect rate limits; no PHI in logs.
- Keep tariff and grouper versions explicit on every result; results from different
  grouper versions are not compared without noting it.
- Any AI/LLM-assisted analysis over medical records requires an ADR first (PHI processing).
