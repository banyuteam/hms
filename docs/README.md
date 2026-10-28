# docs — product inputs & references

Everything here comes from the product owner (or is an architecture decision). Code never
lives here — it goes in `source/`.

| Folder | Put here | Example |
|---|---|---|
| `prd/` | Your PRD drafts, one file per project, named after the project folder | `prd/claim-assistant.md` |
| `skills/<project>/` | Your skill drafts for that project | `skills/event-streaming/add-cdc-table.md` |
| `mockups/` | UI mockups: HTML, PNG, screenshots of Khanza screens | `mockups/hospital-patient-workspace.html` |
| `references/khanza-schema/` | Khanza DB **structure only** (`mysqldump --no-data`) | `references/khanza-schema/sik-2026-10.sql` |
| `references/regulations/` | Permenkes, BPJS/Kemenkes coding guidelines, PDP law notes | `references/regulations/pmk-24-2022.pdf` |
| `references/integration-specs/` | BPJS VClaim, E-Klaim, SATUSEHAT specs (with version in the name) | `references/integration-specs/eklaim-5.x.pdf` |
| `references/code-systems/` | ICD-10, ICD-9-CM source files in the INA-CBG edition | `references/code-systems/icd10-inacbg.xlsx` |
| `references/` (other) | Anything else: claim reports, meeting notes, process maps | `references/claim-pending-sample-anonymised.xlsx` |
| `decisions/` | Architecture Decision Records (ADRs) | `decisions/0001-event-capture-approach.md` |
| `glossary.md` | Domain terms | — |

**Before adding a file:** remove or anonymise any real patient data (names, NIK, BPJS
number, MRN, addresses). Claim samples must be anonymised.

Final versions of PRDs and skills live with their project in `source/<project>/`.
