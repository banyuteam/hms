# Glossary

| Term | Meaning |
|---|---|
| SIMRS Khanza | The current hospital information system (Java desktop app + MariaDB). Stays in operation |
| No. RM / `no_rkm_medis` | Medical record number (MRN) of a patient |
| `no_rawat` | Visit / encounter number in Khanza (one per outpatient visit or inpatient stay) |
| NIK | National identity number (16 digits) |
| BPJS Kesehatan | National health insurer (JKN program) |
| No. Kartu BPJS | Patient's BPJS membership number |
| SEP | Surat Eligibilitas Peserta — BPJS eligibility letter issued per visit; key for claims |
| VClaim | BPJS web service for eligibility, SEP and referrals |
| INA-CBG | Indonesian case-based groups — the tariff grouping BPJS pays hospital claims by |
| E-Klaim | Kemenkes application/web service that groups a claim into an INA-CBG code and tariff |
| Pending claim | Claim BPJS verifiers have held back for clarification or missing evidence |
| ICD-10 | Diagnosis code system (WHO 2010 edition as used by INA-CBG) |
| ICD-9-CM | Procedure code system used by INA-CBG |
| Resume medis | Discharge summary — the core document for a claim |
| Rawat jalan / rawat inap / IGD | Outpatient / inpatient / emergency department |
| Kelas rawat | Inpatient care class (affects tariff) |
| SATUSEHAT | Kemenkes national health data platform (FHIR R4) |
| PSrE | Certified electronic-signature provider in Indonesia (required for legally binding e-sign) |
| PHI | Protected health information — any data identifying a patient or their health |
| CDC | Change data capture — reading database changes (here: from the MariaDB binlog) |
| Outbox pattern | A service saves an event in its own database in the same transaction as the change, then publishes it |
| ADR | Architecture decision record — short document recording a technical decision and why |
| Strangler-fig | Migration style: the new system takes over one area at a time while the old one keeps running |
| Workspace / window / dock | Web-frontend UI model: floating windows on a canvas, with a bottom dock holding one tab per open window |
| Mode baca | Read-only mode — write actions disabled while a domain is not yet writable in the new platform (Phase 1) |
| Clear space (zona lega) | Design rule: calm, mostly empty canvas with minimum margins between windows so users aren't overwhelmed |
| DPJP | Dokter Penanggung Jawab Pelayanan — the attending physician responsible for the patient |
| `id` / `en` locales | UI languages of the web-frontend: Bahasa Indonesia (default) and English; message catalogs `id.json`, `en.json` |
| Ruang Fokus | "Focus room" — dedicated calm view of the workspace (wallpaper, clock, break timer) that hides windows and patient data; not the same as the lock screen |
