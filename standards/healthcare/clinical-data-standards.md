# Clinical Data Standards Baseline

Workspace standard for the native clinical record (ADR-DB-004, ADR-DB-005). It applies to `hms_database` (schemas),
`hms_services` (runtime, exchange) and `hms_workspace` (presentation).

**How to read the tags:**
- **[V]** means the fact was checked against the primary text on 2026-11-09. Sources are listed at the end.
- **[C]** means the item must be confirmed with the named owner before production.
- This is engineering guidance, not legal advice. Hospital legal, the DPO, clinical governance and PMIK confirm
  interpretations.

## 1. Regulatory baseline

### Permenkes 24/2022 — Rekam Medis
| Article | Requirement | How HMS meets it |
|---|---|---|
| Pasal 14(2) [V] | Identity data includes at least the medical record number, name and NIK | `patient.identifiers` (MRN system per organization, NIK), `patient.names` |
| Pasal 14(4) [V] | Social data includes at least religion, occupation, education and marital status | `patient.patients` coded columns, bound to Kepmenkes 1423 value sets |
| Pasal 16(2) [V] | Each entry carries the provider's name, time and signature | practitioner columns (recorder/performer/author) + `resource_versions` actor and time; `clinical.signatures` |
| Pasal 16(4), 30(5)-(7) [V] | Providers or admin staff (incl. PMIK) may correct errors within 2x24 hours; later administrative corrections need PMIK and/or facility-head approval | DB: corrections keep history and need a reason for finalized records. hms_services: time window and approval workflow [C clinical governance] |
| Pasal 20(2)-(5) [V] | Storage guarantees security, integrity, confidentiality and availability; a backup system is mandatory, kept at a different location from the facility, periodic, per SOP | RUNBOOK: PITR, off-site copy, restore drills (production target still to be verified) |
| Pasal 21 [V] | RME connects to the Kemenkes interoperability platform | `integration.outbound_submissions`, `external_resource_ids`, SATUSEHAT profiles in `knowledge.fhir_profiles` |
| Pasal 22(1) [V] | Outsourced storage must be in-country | Deployment decision: PostgreSQL and backups hosted in Indonesia [C infrastructure owner] |
| Pasal 29 [V] | Confidentiality, integrity and availability; only authorised persons change data (29(3)) | IAM authorization (hms_services), tenant RLS, versioning, no deletes, audit |
| Pasal 31 [V] | Electronic signature optional, verifies content and signer | `clinical.signatures` over the version hash; signing in hms_services |
| Pasal 32 [V] | Confidentiality continues after the patient's death | No status relaxes access rules for deceased patients |
| Pasal 33-37 [V] | Disclosure of record content is governed; without consent it must be de-identified (35(2)) | `privacy.disclosures`; `analytics` pseudonymized views |
| Pasal 39 [V] | Retained at least 25 years from the last visit; may be kept longer if still used; destruction per regulation | No DELETE on record tables; retention execution not built [C] |
| Pasal 45 [V] | Electronic records mandatory by 31 Dec 2023 | — |

- **Correction rule:** the requirement that a correction must not erase the original entry comes from the repealed
  Permenkes 269/2008, not from 24/2022. HMS keeps the original anyway, as a design rule (ADR-DB-005).
- **"SATUSEHAT":** the Permenkes speaks of "platform layanan interoperabilitas ... yang dikelola oleh Kementerian
  Kesehatan". Equating it with SATUSEHAT comes from Kemenkes documentation.

### Kepmenkes HK.01.07/MENKES/1423/2022 — RME variables and metadata
- **[V] Data sets:** IGD, Rawat Jalan, Rawat Inap, Laboratorium and Apotek. IGD, Rawat Jalan and Rawat Inap contain:
  - Lembar Identitas (general patient identity; newborn identity);
  - Cara Pembayaran;
  - General Consent;
  - setting-specific assessments.
- **[V] Identity code lists** (annex, Identitas Umum Pasien). They are loaded as governed value sets
  (`terminology.value_sets`) from the official text, never typed into migrations:

| Variable | Codes |
|---|---|
| Jenis kelamin | 0 Tidak diketahui; 1 Laki-laki; 2 Perempuan; 3 Tidak dapat ditentukan; 4 Tidak mengisi |
| Agama | 1 Islam; 2 Kristen (Protestan); 3 Katolik; 4 Hindu; 5 Budha; 6 Konghucu; 7 Penghayat; 8 Lain-lain (free text) |
| Pendidikan | 0 Tidak sekolah; 1 SD; 2 SLTP sederajat; 3 SLTA sederajat; 4 D1-D3 sederajat; 5 D4; 6 S1; 7 S2; 8 S3 |
| Pekerjaan | 0 Tidak bekerja; 1 PNS; 2 TNI/POLRI; 3 BUMN; 4 Pegawai Swasta/Wirausaha; 5 Lain-lain (free text) |
| Status pernikahan | 1 Belum Kawin; 2 Kawin; 3 Cerai Hidup; 4 Cerai Mati |

- **[V] NIK:** 16 digits. `9999999999999999` means "no NIK" and is refused as a stored identifier, because absence
  is the absence of the row.
- **[V] Foreign nationals:** passport or KITAS number.
- **[V] Address:** RT/RW and Kemendagri regional codes.
- **[V] Newborns:** "bayi Ny. …" with the mother's NIK (`nik-ibu`, not unique).
- **[V] Nomor IHS Pasien:** "P" followed by 11 digits (Lab/Apotek data sets).
- **[C] Recorded vs. exchanged sex:** "Jenis kelamin" is recorded as the national code (`gender_code`).
  `administrative_gender` is the FHIR value used for exchange. Clinical governance approves the mapping (concept
  map); it is not inferred.

### UU 27/2022 — Pelindungan Data Pribadi
| Article | Requirement | How HMS meets it |
|---|---|---|
| Pasal 4(2) [V] | Health data is specific personal data | Patient/clinical schemas classified restricted |
| Pasal 6-9, 11, 13 [V] | Rights: rectify, access/copy, end processing/delete per law, withdraw consent, restrict, portability | `privacy.data_subject_requests`; consent withdrawal in `patient.consents` |
| Pasal 14 [V] | Requests are recorded | `data_subject_requests` (versioned) |
| Pasal 15 [V] | Exceptions (not access/correction) | Decision reason recorded per request |
| Pasal 34 [V] | DPIA for high-risk processing (incl. specific data, large scale) | `processing_activities.dpia_reference` required for active specific-data processing |
| Pasal 41 [V] | Restriction request acted on within 3x24 hours | `due_at` set by hms_services policy [C DPO] |
| Pasal 43-44 [V] | Deletion/destruction subject to retention law | Erasure inside the Permenkes retention period is refused with recorded basis |
| Pasal 46 [V] | Breach notice to subjects and the authority within 3x24 hours | Security incident process (Workstream 3); disclosure and audit data support scoping [C] |
| Pasal 53 [V] | DPO required (incl. large-scale specific data; Constitutional Court 151/PUU-XXII/2024: conditions alternative) | Organizational [C] |

- **[C DPO] Lawful bases:** `processing_activities.legal_basis` uses consent, contract, legal obligation, vital
  interest, public task and legitimate interest. The DPO confirms the list against Pasal 20.

## 2. Interoperability and clinical modelling

### HL7 FHIR R4 and SATUSEHAT
- **[V] Version:** SATUSEHAT uses FHIR R4.
- **[V] Profiles:** published at `https://fhir.kemkes.go.id/r4/StructureDefinition/{Name}`. Registered in
  `knowledge.fhir_profiles` with checksum; validation results are stored per resource version.
- **[V] Identifier systems** (seeded in `terminology.identifier_systems`):

  | System | URI |
  |---|---|
  | NIK | `https://fhir.kemkes.go.id/id/nik` |
  | NIK ibu | `https://fhir.kemkes.go.id/id/nik-ibu` |
  | Passport | `https://fhir.kemkes.go.id/id/paspor` |
  | KK | `https://fhir.kemkes.go.id/id/kk` |

- **[C] Organization-scoped systems:** `http://sys-ids.kemkes.go.id/{encounter|organization|location|medication}/{org IHS id}`.
  Registered per organization once its IHS id is known.
- **[C] IHS number URI:** not seeded until confirmed (`.../id/ihs-number` vs `.../id/patient-ihs-number`).
- **[V] Address extension:** `https://fhir.kemkes.go.id/r4/StructureDefinition/administrativeCode` (province, city,
  district, village, rt, rw). Maps to the `patient.addresses` code columns.
- **[V] Medication code system:** KFA, `http://sys-ids.kemkes.go.id/kfa` (seeded).
- **Canonical tables:** follow FHIR R4 resources. Status codes are the R4 required value sets, and row-local
  invariants are CHECK constraints. Exchange payloads are generated by hms_services from one resource version
  (`resource_versions`); payloads are never stored, only their hash.
- **API conformance:**
  - hms_services publishes a CapabilityStatement for its FHIR façade when one is built;
  - `integration.validation_results` holds profile validation outcomes (issue codes and paths, no values);
  - submissions are idempotent per resource version.

### Terminology
- **Coded values:** stored as `(system, code, display)`, and the system must be registered.
- **Content:** imported per release with source, checksum, licence and approval, and immutable afterwards.
- **Code systems:**
  - LOINC (observations, documents);
  - SNOMED CT (findings, procedures, body sites);
  - ICD-10 (diagnoses);
  - ICD-9-CM (procedures for claims);
  - UCUM (units);
  - KFA (medicines);
  - DICOM DCM (modalities);
  - HL7 code systems.
- **[C] Licensing:**
  - SNOMED CT requires a licence. Confirm Indonesia's membership or affiliate status before loading content.
  - ICD editions in national use are confirmed by coding governance.
- **Concept maps:** `terminology.concept_maps` uses FHIR R4 equivalence. Legacy Khanza codes map to standard codes
  through approved maps, never by guessing.

### openEHR
- **[V] RM release:** RM 1.1.0 is the latest release.
- **[V] Archetype ids:** `rm_publisher-rm_closure-rm_class.concept.vN`, e.g.
  `openEHR-EHR-OBSERVATION.blood_pressure.v2`.
- **[V] Archetype source:** the Clinical Knowledge Manager, `https://ckm.openehr.org/ckm/`.
- **Templates:** structured documents conform to an active template (`knowledge.templates`).
  `knowledge.template_bindings` maps each data point to the canonical column, FHIR element and terminology concept.
  This is how one structured form feeds the relational record, FHIR exchange and analytics with the same meaning.

### DICOM / PACS
- **[V] DICOMweb** (PS3.18): QIDO-RS (search), WADO-RS (retrieve), STOW-RS (store).
- **[V] FHIR ImagingStudy:** carries the Study Instance UID as identifier system `urn:dicom:uid`, value
  `urn:oid:<uid>`.
- **HMS storage:** HMS stores study/series UIDs, the accession number and counts (`imaging`). Images stay in PACS
  and are retrieved through hms_services.

## 3. Security, audit and recovery rules for clinical data
- **Authorization:**
  - Every request is authorized by hms_services (`iam.effective_permissions`).
  - The database records the actor (ADR-DB-005) and enforces tenant isolation; frontend visibility is not
    authorization.
- **Audit:** read access is audited in `audit.audit_events` (resource type/id, never values). Changes are in
  `resource_versions`. The audit chain is anchored externally (`audit.chain_anchors`).
- **Minimization:** no PHI in events, logs, metrics or analytics labels. Analytics uses pseudonyms; small cells are
  suppressed by the reporting process [C].
- **Recovery:** PITR with off-site, in-country copies and restore drills (Permenkes 24/2022 Pasal 20, 22), and no
  deletion inside the retention period.

## Sources (checked 2026-11-09)
- Permenkes 24/2022: https://www.peraturan.go.id/files/bn829-2022.pdf (status per https://peraturan.bpk.go.id/Details/245544)
- Kepmenkes HK.01.07/MENKES/1423/2022: https://jdih.kemkes.go.id/storage/documents/pdfs/2022kepmenkes1423.pdf
- UU 27/2022: https://peraturan.bpk.go.id/Details/229798
- SATUSEHAT FHIR R4 documentation: https://satusehat.kemkes.go.id/platform/docs/
- openEHR specifications: https://specifications.openehr.org/releases/RM/latest ; CKM: https://ckm.openehr.org/ckm/
- DICOMweb: https://www.dicomstandard.org/using/dicomweb ; FHIR R4 ImagingStudy: https://hl7.org/fhir/R4/imagingstudy.html
