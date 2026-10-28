# HMS Modernization — Root Instructions

This repository manages the end-to-end migration of the hospital's running **SIMRS Khanza**
(Java Swing monolith on MariaDB 10.6.26) to a web-based, microservice architecture, plus a
data warehouse, a medical-records web service with e-signature, and a BPJS claim assistant.

These are the rules every project follows. Each project under `source/` has its own
`CLAUDE.md` that adds to these; when you work inside a project, read its `CLAUDE.md` and
`PRD.md` first.

## Ground rules (non-negotiable)

1. **Khanza stays untouched.** The production Khanza app and its MariaDB database remain the
   operational system of record.
   - Never run DDL (`CREATE/ALTER/DROP`), triggers, stored procedures, or writes against the
     Khanza database. Never propose changes to Khanza's Java code as a dependency of our work.
   - Access Khanza data only through: (a) the CDC stream from `source/event-streaming/`, or
     (b) a read-only DB user, preferably on a replica. Never against the primary for heavy queries.
   - Any future write-back to Khanza (e.g. a migrated domain must sync back) requires an ADR
     in `docs/decisions/` approved by the user before any code is written.
2. **Patient data is protected health information (PHI).** Indonesian rules apply
   (UU 27/2022 Pelindungan Data Pribadi, Permenkes 24/2022 Rekam Medis Elektronik).
   - No real patient data in the repo, fixtures, tests, logs, screenshots or prompts. Use
     synthetic data only. (Names in `docs/mockups/` are demo data.)
   - Mask NIK, No. BPJS, phone, address and names in logs; never log full payloads.
   - Don't send PHI to external services (including AI/LLM APIs, pastebins, public CDNs)
     unless an ADR approves the processor and data-sharing basis.
   - Secrets (DB passwords, BPJS cons-id/secret, E-Klaim key, e-sign credentials) come from
     environment/secret store only. Never commit them; use `.env.example` with placeholders.
3. **Strangler-fig migration.** The new platform grows beside Khanza, domain by domain.
   Phase 1 is read-side (projections from CDC). A domain becomes writable in the new
   platform only when its PRD and ADR say so.
4. **Don't decide architecture silently.** Choosing or changing a language, framework,
   broker, database engine, or integration approach needs an ADR
   (`docs/decisions/NNNN-title.md`, from `0000-adr-template.md`). If a choice isn't recorded
   yet, propose it and ask instead of picking one in code.

## Repository layout

```
hms/
├── CLAUDE.md, README.md
├── docs/        ← INPUTS & REFERENCES owned by the user (product side)
│   ├── prd/          user-written PRD drafts, one per project (<project>.md)
│   ├── skills/       user-written skill drafts, one folder per project
│   ├── mockups/      UI mockups (HTML, images) — visual reference, don't edit
│   ├── references/   khanza-schema/, regulations/, integration-specs/, code-systems/, …
│   ├── decisions/    ADRs (architecture decision records)
│   └── glossary.md   domain terms (Indonesian ↔ English)
└── source/      ← EVERYTHING CLAUDE BUILDS (one folder per project)
    ├── shared/ event-streaming/ data-warehouse/ web-frontend/
    ├── backend-services/ database/ medical-records-api/ claim-assistant/
```

| Project (`source/…`) | Requirement | Purpose |
|---|---|---|
| `event-streaming/` | #2 | CDC from Khanza MariaDB → event broker; raw change topics + translation to domain events |
| `data-warehouse/` | DWH | Ingest events into staging → modeled warehouse/marts for reporting |
| `web-frontend/` | #3 | Web workspace that replicates the Khanza desktop UX |
| `backend-services/` | #3 | Domain microservices (patient, encounter, orders, billing, …) + API gateway |
| `database/` | #3 | Schemas & migrations for the new services' own databases (database-per-service) |
| `medical-records-api/` | #4 | Secured medical-record web service + e-signature |
| `claim-assistant/` | #5 | BPJS / INA-CBG claim mitigation, ICD-10 & ICD-9-CM catalogue |
| `shared/` | all | Cross-project contracts: event schemas, OpenAPI specs, code-system references |

Where things go:
- **All code, configs, tests, generated docs and technical notes** → `source/<project>/`
  (technical notes in `source/<project>/docs/`). Never write code under `docs/`.
- **`docs/` is input from the user.** Read it; don't edit the user's files there. Claude may
  add ADRs to `docs/decisions/` (status `proposed` until the user accepts) and update
  `docs/glossary.md`.
- Each project is self-contained (own build, tests, README, `.env.example`). Cross-project
  dependencies go through `source/shared/` contracts — never import another project's internal
  code or read another service's database.

## PRD and skill workflow

Each project folder `source/<project>/` contains:

- `README.md` — for humans: purpose, status, how to run.
- `CLAUDE.md` — how Claude works in that project.
- `PRD.md` — the **final PRD**, the source of truth for scope and acceptance criteria.
- `.claude/skills/<skill-name>/SKILL.md` — the **final skills** for that project (Claude Code
  only loads skills from `.claude/skills/`, so this path is fixed).

Flow from draft to final:
1. The user writes a draft in `docs/prd/<project>.md` (and skill drafts in
   `docs/skills/<project>/`), plus any references in `docs/references/` or `docs/mockups/`.
2. When asked, Claude turns the draft into `source/<project>/PRD.md` (or a `SKILL.md`):
   same intent, structured to the template, with open questions listed — never inventing
   requirements. The header records the draft it came from and its date.
3. The user reviews and sets `Status: Approved`. Until then (or while the PRD is a stub),
   Claude may scaffold and run spikes but asks before building features.
4. If the draft changes later, update the final PRD and note what changed.

When the PRD and a `CLAUDE.md` disagree, the PRD wins on *what* to build and `CLAUDE.md` wins
on *how* (safety rules above always win). Point out the conflict to the user.

## Target architecture (summary)

```
Khanza (Java Swing) ──writes──> MariaDB (Khanza, unchanged)
                                   │ binlog (ROW)
                                   ▼
                     event-streaming: CDC connector ──> raw topics  khanza.<table>
                                   │ translators (anti-corruption layer)
                                   ▼
                              domain events  <domain>.<entity>.<event>.v<N>
                     ┌─────────────┼───────────────┬─────────────────┐
                     ▼             ▼               ▼                 ▼
              backend-services  medical-records  claim-assistant  data-warehouse
              (own DBs)         -api (+e-sign)    (BPJS/INA-CBG)   (staging→marts)
                     └──── API gateway / BFF ──── web-frontend (browser workspace)
```

New services publish their own events via the **transactional outbox** pattern.

### Event capture approach (requirement #2)

Recommended: **log-based CDC** (e.g. Debezium MySQL/MariaDB connector reading the binlog)
for Khanza, because it captures inserts/updates/deletes with no change to Khanza's code or
schema. Outbox needs Khanza to write to an outbox table (code change — not allowed); query
polling misses deletes and needs reliable `updated_at` columns, which Khanza tables often lack;
managed cloud CDC adds cost and sends PHI off-premise. **Status: pending ADR-0001 — confirm
with the user.** CDC rows are *change events*, not domain events; translate them before other
services consume them.

## Domain notes

- Khanza schema names are Indonesian (e.g. `pasien`, `reg_periksa`, `kamar_inap`,
  `diagnosa_pasien`, `prosedur_pasien`, `penyakit`, `icd9`, `bridging_sep`). Always verify
  names and columns against the schema snapshot in `docs/references/khanza-schema/`
  (structure only, no data) — never guess.
- Key identifiers: `no_rkm_medis` (MRN), `no_rawat` (visit/encounter id), NIK, No. Kartu BPJS,
  No. SEP. Treat all as PHI. See `docs/glossary.md`.
- External systems: BPJS VClaim / Antrean, INA-CBG E-Klaim, SATUSEHAT (FHIR R4). Official
  specs go in `docs/references/integration-specs/`; note the spec version used in code.
- Code systems: ICD-10 (the WHO 2010 edition used by INA-CBG) and ICD-9-CM for procedures.
  Use the editions INA-CBG/E-Klaim accept, not the newest ones. Source files go in
  `docs/references/code-systems/`.
- UI text: Bahasa Indonesia is the primary UI language; code, identifiers, commits and docs in
  English. Keep Indonesian domain terms where they're the established term (SEP, rawat inap).

## Engineering conventions

- Contracts first: define/update the event schema or OpenAPI spec in `source/shared/` before
  the implementation, and version them (`.v1`, `/v1`). Breaking changes get a new version.
- Every service: health endpoint, structured JSON logs (PHI-masked), correlation id passed
  through HTTP headers and event metadata, idempotent event consumers (dedupe by event id).
- Tests are required for business rules (claim rules, mapping, e-sign verification). Use
  synthetic fixtures. Run the project's tests before calling work done, and report failures
  with output.
- Audit: any read or write of a medical record in new services emits an audit event
  (who, what, when, why). Required by Permenkes 24/2022.
- Time: store UTC, display Asia/Jakarta. Money: integer Rupiah (no floats).
- Keep commits scoped to one project where possible; prefix the message with it,
  e.g. `event-streaming: add reg_periksa connector config`.
- Keep each project's `README.md` status line current when its phase changes.

## Working with the user

- The user is the product owner: they own everything in `docs/` (except Claude-proposed ADRs
  and the glossary) and approve final PRDs and skills. Suggest changes instead of rewriting.
- Ask when a decision belongs to the hospital (regulatory interpretation, vendor choice such as
  the e-sign provider, data retention, who may see what).
- This folder is not yet a git repository; suggest `git init` before the first real code.
