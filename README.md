# HMS Modernization

Moving the hospital's running **SIMRS Khanza** (Java desktop app on MariaDB) to a modern web
platform, step by step, **without disrupting Khanza**. Khanza and its database keep running for
daily operations; the new platform reads its data through a change stream and grows beside it.

## What we're building

| Goal | Project |
|---|---|
| Keep Khanza and its MariaDB running unchanged | — (rule for every project) |
| Capture every Khanza change into PostgreSQL by hash-based range polling | [`hms_services/cdc-polling`](source/hms_services/cdc-polling/) |
| Publish captured changes as events (broker, translators) | [`hms_services/event-streaming`](source/hms_services/event-streaming/) |
| Web app that replicates the Khanza desktop screens | [`hms_web-frontend-UIUX/web-workspace`](source/hms_web-frontend-UIUX/web-workspace/) |
| Tooling for developers, DBAs, data engineers (reports, ETL, developer docs) | [`hms_web-frontend-UIUX/web-datatooling`](source/hms_web-frontend-UIUX/web-datatooling/) |
| API gateway, audit log, webhooks, secure medical records with e-signature | [`hms_services/api-gateway`](source/hms_services/api-gateway/) |
| Domain microservices | [`hms_services/domain-services`](source/hms_services/domain-services/) |
| AI claim assistant (BPJS / INA-CBG) | [`hms_services/ai-claim-assistant`](source/hms_services/ai-claim-assistant/) |
| Single sign-on for doctors, employees, patients | [`hms_services/sso`](source/hms_services/sso/) |
| PostgreSQL 18 databases + ICD-10 / ICD-9-CM catalogue | [`hms_database`](source/hms_database/) |
| Contracts shared between projects | [`hms_shared`](source/hms_shared/) |

Each project's `README.md` shows its current status.

## How the repository is organised

Three top-level areas, kept strictly separate:

```
hms/
├── README.md          ← you are here
├── CLAUDE.md          ← rules for Claude (also a good summary of engineering rules)
├── docs/              ← 1. YOUR REFERENCES (owned by the product owner, manual inputs)
│   ├── prd/             PRD drafts (e.g. 001-Frontend-Workspace-HMS.md)
│   ├── skills/          skill drafts, one folder per project
│   ├── mockups/         UI mockups, logos (HTML, images)
│   ├── references/      Khanza schema, regulations, BPJS/E-Klaim/SATUSEHAT specs, ICD files
│   ├── decisions/       architecture decisions (ADRs)
│   └── glossary.md      domain terms
├── design/            ← 2. PLAN & DESIGN of each project
│   └── <group>/<project>/   (hms_database, hms_shared: no sub-level)
│       ├── README.md      index & status of the plan/design
│       ├── PRD.md         final PRD (approved requirements)
│       ├── CLAUDE.md      how Claude works on the plan/design (when needed)
│       ├── .claude/skills/<name>/SKILL.md   final skills
│       └── … open questions, research, design notes (Figma, tokens, wireframes)
└── source/            ← 3. THE CODE (same group/project names as in design/)
    └── <group>/<project>/
        ├── README.md      purpose, status, how to run
        ├── CLAUDE.md      how Claude works on the code
        ├── .claude/skills → ../../../../design/<group>/<project>/.claude/skills   (symlink)
        └── … code, tests, configs, technical docs
```

**Rule of thumb:** `docs/` is what we *know and want*, `design/` is what we *plan and design*,
`source/` is what we *build*.

## Workflow

1. **Product owner** writes or updates a draft PRD in `docs/prd/` and adds mockups or
   references in `docs/`.
2. **Claude** turns the draft into the final `design/<project>/PRD.md` and lists open questions;
   design (Figma, tokens, UX research) is kept in `design/<project>/`.
3. **Product owner** reviews and marks it `Approved`.
4. **Claude / developers** build in `source/<project>/`. Big technical choices (language,
   database, vendors) are written up as ADRs in `docs/decisions/` and approved first.
5. Repeat the loop: plan → design → design review → code → code review.

Skills follow the same path: draft in `docs/skills/<project>/`, final in
`design/<project>/.claude/skills/<skill-name>/SKILL.md` (symlinked into `source/<project>/.claude/skills`
so Claude Code also loads them while coding; on Windows enable git symlinks or copy the folder).

## Key decisions so far

| Topic | Status |
|---|---|
| Event capture from Khanza | CDC query polling on a read-only replica (product owner, 2026-10-29). ADR-0001 proposed |
| Change detection without `updated_at` | Hash-based reconciliation over fixed-size primary-key ranges, `cdc-polling` (2026-10-30). ADR-0005 proposed |
| cdc-polling stack | Python 3.10+, PyMySQL, psycopg 3. ADR-0006 proposed |
| New services' database | PostgreSQL 18. ADR-0004 proposed |
| Tech stack per other project | Not decided — one ADR per choice |
| E-signature provider | Hospital to choose a certified provider (PSrE) |

## Data protection

This project handles patient medical records. Never commit real patient data, credentials,
or database dumps with data. Use synthetic test data only. See the rules in `CLAUDE.md`.
