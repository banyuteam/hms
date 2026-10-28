# medical-records-api — Instructions

A secured web service that exposes medical records to authorised consumers and signs
clinical documents electronically. Read the root `CLAUDE.md` and this folder's `PRD.md` first.

## Scope

- Read API for medical records (patient summary, encounters, diagnoses, procedures, notes,
  results, medications, resume medis), sourced from domain events / service read models.
- Interoperability: a FHIR R4 representation aligned with SATUSEHAT profiles where the PRD
  asks for it.
- E-signature of clinical documents (e.g. resume medis, surat keterangan, hasil lab):
  document generation → signing → verification → archival.
- Consent, access audit and disclosure log.

## Rules

- Follow `source/backend-services/` conventions (stack, OpenAPI in `source/shared/api/`, outbox, health).
- Security baseline: TLS everywhere (mTLS for system-to-system clients), OAuth2/OIDC with
  scoped tokens, rate limiting, request signing for external partners if the PRD requires.
  Least-privilege scopes per consumer (e.g. `records:summary:read`).
- Every request that returns PHI writes an audit record: client, user, patient, purpose,
  fields returned, time. Audit records are append-only.
- E-signature: legally binding signatures in Indonesia require a certified provider (PSrE,
  per PP 71/2019). The provider is the hospital's decision — don't pick one. Design behind a
  `SignatureProvider` interface, use PAdES for PDFs, include a trusted timestamp, store the
  signed document hash, and provide a verification endpoint. Private keys never touch our
  code or storage unless the ADR says so (prefer provider-held keys / HSM).
- Signed documents are immutable; corrections create a new version linked to the old one.
- Retention and access rules follow Permenkes 24/2022; ask the user for the hospital policy.
- Tests: authorization matrix tests (who may see what), signature/verification tests with
  test certificates, FHIR validation for any FHIR output.
