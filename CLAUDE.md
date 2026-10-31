# HMS Modernization — Root Instructions

This repository manages the end-to-end migration of the hospital's running **SIMRS Khanza**
(Java Swing monolith on MariaDB 10.6.26) to a web-based, microservice architecture, plus a
data warehouse, a medical-records web service with e-signature, and a BPJS claim assistant.

These are the rules every project follows. In the paths below `<project>` means `<group>/<project>` (e.g. `hms_services/sso`; `hms_database` and `hms_shared` have no sub-level). Each project has a *design* folder (`design/<project>/`:
PRD, plans, design, skills) and a *source* folder (`source/<project>/`: the code). Each has its own
`CLAUDE.md` where useful; when you work on a project, read `design/<project>/PRD.md` and the
`CLAUDE.md` of the folder you are working in first.

## Ground rules (non-negotiable)

1. **Khanza stays untouched.** The production Khanza app and its MariaDB database remain the
   operational system of record.
   - Never run DDL (`CREATE/ALTER/DROP`), triggers, stored procedures, or writes against the
     Khanza database. Never propose changes to Khanza's Java code as a dependency of our work.
   - Access Khanza data only through: (a) the CDC stream from `source/hms_services/event-streaming/`, or
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
   platform only when its PRD and ADR say so. The goal is to migrate from the monolith to microservices architecture.
4. **Don't decide architecture silently.** Choosing or changing a language, framework,
   broker, database engine, or integration approach needs an ADR
   (`docs/decisions/NNNN-title.md`, from `0000-adr-template.md`). If a choice isn't recorded
   yet, propose it and ask instead of picking one in code.

## Repository layout

Three top-level areas with a strict separation:

```
hms/
├── CLAUDE.md, README.md
├── docs/        ← 1. REFERENCES owned by the user (manual inputs) — Claude reads, doesn't restructure
│   ├── prd/          user-written PRD drafts (e.g. 001-Frontend-Workspace-HMS.md)
│   ├── skills/       user-written skill drafts, one folder per project
│   ├── mockups/      UI mockups, logos (HTML, images) — visual reference, don't edit
│   ├── references/   khanza-schema/, regulations/, integration-specs/, code-systems/, …
│   ├── decisions/    ADRs (architecture decision records)
│   └── glossary.md   domain terms (Indonesian ↔ English)
├── design/      ← 2. PLAN & DESIGN of each project (final PRD, skills, design, open questions, research)
│   └── <project>/
│       ├── README.md   index & status of the plan/design
│       ├── PRD.md      final PRD (source of truth for scope)
│       ├── CLAUDE.md   how Claude works on the plan/design (when the project needs one)
│       ├── .claude/skills/<name>/SKILL.md   final skills
│       └── … open-questions.md, research, design notes (Figma links, tokens, wireframe specs)
└── source/      ← 3. THE CODE: scaffolds and implementations, folder name = project name
    └── <project>/
        ├── README.md   purpose, how to run, status of the code
        ├── CLAUDE.md   how Claude works on the code
        ├── .claude/skills → ../../../../design/<group>/<project>/.claude/skills   (link, see below)
        └── … code, tests, configs, technical docs
```

Projects live in four groups, identically under `design/` and `source/` (group folders carry the `hms_` prefix;
`hms_shared` has no PRD):

| Project (`design/…` + `source/…`) | Purpose |
| :-- | :-- |
| `hms_web-frontend-UIUX/web-workspace/` | Web workspace that replicates the Khanza desktop UX |
| `hms_web-frontend-UIUX/web-datatooling/` | For backend developers, DBAs, data engineers: report management, ETL tool (events → staging → warehouse/marts), developer documentation |
| `hms_services/cdc-polling/` | Python CDC capture: hash-based PK-range polling of the Khanza replica → PostgreSQL 18 mirror + `cdc.change_event` outbox (ADR-0005) |
| `hms_services/event-streaming/` | Relays captured changes to the event broker; raw change topics + translation to domain events |
| `hms_services/api-gateway/` | Audit log, webhooks, document log; secured medical-record web service + e-signature |
| `hms_services/domain-services/` | Domain microservices (patient, encounter, orders, billing, …) + APIs |
| `hms_services/ai-claim-assistant/` | AI chatbot agent for BPJS / insurance claims (medical records, diagnoses, procedures, INA-CBG mitigation) |
| `hms_services/sso/` | Single sign-on for doctors, employees and patients |
| `hms_database/` | PostgreSQL 18: databases for domain microservices, ICD-10 & ICD-9-CM catalogue |
| `hms_shared/` | Cross-project contracts: event schemas, OpenAPI specs, code-system references |

Earlier names → current: `web-frontend`→`web-workspace`, `data-warehouse`→`web-datatooling`,
`medical-records-api`→`api-gateway`, `backend-services`→`domain-services`,
`claim-assistant`→`ai-claim-assistant`, `database`→`hms_database`, `shared`→`hms_shared`.

Where things go:
- **All code, configs, tests, generated code and technical notes about the code** → `source/<project>/`
  (notes in `source/<project>/docs/`). Never write code under `docs/` or `design/`.
- **Plans and design** — final PRD, final skills, open questions, research, design specs, Figma
  links, token docs, wireframe/mockup notes → `design/<project>/`. No code there (design-token
  reference files such as `tokens.css`/`tokens.json` are design artefacts and may live in a skill).
- **`docs/` is input from the user.** Read it; don't edit or restructure the user's files there.
  Claude may add ADRs to `docs/decisions/` (status `proposed` until the user accepts) and update
  `docs/glossary.md`.
- Each project is self-contained (own build, tests, README, `.env.example`). Cross-project
  dependencies go through `source/hms_shared/` contracts — never import another project's internal
  code or read another service's database.

## PRD and skill workflow

Each project has two folders.

`design/<project>/` (plan & design):

- `README.md` — index and status of the plan/design.
- `PRD.md` — the **final PRD**, the source of truth for scope and acceptance criteria.
- `CLAUDE.md` — how Claude works on the plan/design (optional).
- `.claude/skills/<skill-name>/SKILL.md` — the **final skills** for that project.
- `open-questions.md`, research notes and other design documents.

`source/<project>/` (code):

- `README.md` — for humans: purpose, status, how to run.
- `CLAUDE.md` — how Claude works on the code.
- `.claude/skills` — a **relative symlink** to `design/<project>/.claude/skills`. Claude Code only
  loads skills from `.claude/skills/` folders next to the files it works on, so the skills have one
  home (`design/`) and are linked into `source/` so they also load while coding. (On Windows, enable
  symlinks (`git config core.symlinks true`, Developer Mode) or copy the folder.)

Flow from draft to final:
1. The user writes a draft in `docs/prd/` (e.g. `001-Frontend-Workspace-HMS.md`; and skill drafts in
   `docs/skills/<project>/`), plus any references in `docs/references/` or `docs/mockups/`.
2. When asked, Claude turns the draft into `design/<project>/PRD.md` (or a `SKILL.md`):
   same intent, structured to the template, with open questions listed — never inventing
   requirements. The header records the draft it came from and its date.
3. The user reviews and sets `Status: Approved`. Until then (or while the PRD is a stub),
   Claude may scaffold and run spikes but asks before building features.
4. If the draft changes later, update the final PRD and note what changed.
5. Delivery loop: plan → design → design review → code (`source/<project>/`) → code review → repeat.

When the PRD and a `CLAUDE.md` disagree, the PRD wins on *what* to build and `CLAUDE.md` wins
on *how* (safety rules above always win). Point out the conflict to the user.

## Target architecture (summary)

```
Khanza (Java Swing) ──writes──> MariaDB (Khanza, unchanged)
                                   │ read-only SELECT polling (replica)
                                   ▼
                     cdc-polling: hash-range polling ──> PostgreSQL mirror + cdc.change_event
                                   │ relay (event-streaming)
                                   ▼
                     raw topics  khanza.<table>
                                   │ translators (anti-corruption layer)
                                   ▼
                              domain events  <domain>.<entity>.<event>.v<N>
                     ┌─────────────┼───────────────┬─────────────────┐
                     ▼             ▼               ▼                 ▼
              domain-services   api-gateway      ai-claim-assistant  web-datatooling
              (PostgreSQL 18)   (+e-sign,audit) (BPJS/INA-CBG)    (staging→marts)
                     └──── API gateway / BFF ──── web-workspace (browser); sso for login
```

New services publish their own events via the **transactional outbox** pattern.

### Event capture approach (requirement #2)

Chosen by the product owner (2026-10-29): **CDC query polling** of allowlisted tables on a read-only replica,
recorded as proposed `docs/decisions/0001-khanza-cdc-query-polling.md` (not accepted yet). Without `updated_at`,
changes are detected by hash-based reconciliation over fixed-size primary-key ranges with independent scan
checkpoints (`source/hms_services/cdc-polling/`, proposed ADR-0005, Python per proposed ADR-0006). Trade-offs: polling
cannot see deletes by itself and needs a change marker per table (Khanza tables often lack `updated_at`), so each
table records its marker and a delete-reconciliation strategy. Log-based CDC (binlog) stays the fallback; outbox
and triggers need writes to Khanza and are not allowed. Polled rows are *change events*, not domain events;
translate them before other services consume them.

The new services' databases use PostgreSQL 18 (proposed `docs/decisions/0004-postgresql-18-for-new-services.md`).

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
- UI text: English is the default UI language (product owner, 2026-10-28, ADR-0003 Amendment 3); Bahasa
  Indonesia is a fully supported second locale. Code, identifiers, commits and docs in
  English. Keep Indonesian domain terms where they're the established term (SEP, rawat inap).

## Engineering conventions

- Contracts first: define/update the event schema or OpenAPI spec in `source/hms_shared/` before
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
  e.g. `event-streaming: add reg_periksa polling config`.
- Keep each project's `README.md` status line current when its phase changes.

## Working with the user

- The user is the product owner: they own everything in `docs/` (except Claude-proposed ADRs
  and the glossary) and approve the final PRDs and skills in `design/`. Suggest changes instead of rewriting.
- Ask when a decision belongs to the hospital (regulatory interpretation, vendor choice such as
  the e-sign provider, data retention, who may see what).
- This folder is a git repository: don't commit unless the user asks; keep commits scoped to one project (`design/<project>` and `source/<project>` together) with the project prefix.
