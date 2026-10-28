# HMS Modernization

Moving the hospital's running **SIMRS Khanza** (Java desktop app on MariaDB) to a modern web
platform, step by step, **without disrupting Khanza**. Khanza and its database keep running for
daily operations; the new platform reads its data through a change stream and grows beside it.

## What we're building

| # | Goal | Project |
|---|---|---|
| 1 | Keep Khanza and its MariaDB running unchanged | — (rule for every project) |
| 2 | Capture every database change as an event | [`source/event-streaming`](source/event-streaming/) |
| — | Reporting data warehouse | [`source/data-warehouse`](source/data-warehouse/) |
| 3 | Web app that replicates the Khanza desktop screens | [`source/web-frontend`](source/web-frontend/), [`source/backend-services`](source/backend-services/), [`source/database`](source/database/) |
| 4 | Secure medical-records web service with e-signature | [`source/medical-records-api`](source/medical-records-api/) |
| 5 | BPJS claim assistant + ICD-10 / ICD-9-CM catalogue | [`source/claim-assistant`](source/claim-assistant/) |
| — | Contracts shared between projects | [`source/shared`](source/shared/) |

Each project's `README.md` shows its current status.

## How the repository is organised

```
hms/
├── README.md          ← you are here
├── CLAUDE.md          ← rules for Claude (also a good summary of engineering rules)
├── docs/              ← PRODUCT INPUTS & REFERENCES (owned by the product owner)
│   ├── prd/             PRD drafts, one per project
│   ├── skills/          skill drafts, one folder per project
│   ├── mockups/         UI mockups (HTML, images)
│   ├── references/      Khanza schema, regulations, BPJS/E-Klaim/SATUSEHAT specs, ICD files
│   ├── decisions/       architecture decisions (ADRs)
│   └── glossary.md      domain terms
└── source/            ← THE BUILD (one folder per project)
    └── <project>/
        ├── README.md      purpose, status, how to run
        ├── PRD.md         final, approved requirements
        ├── CLAUDE.md      instructions for Claude in this project
        ├── .claude/skills/<name>/SKILL.md   final skills for this project
        └── … code, tests, configs, technical docs
```

**Rule of thumb:** `docs/` is what we *know and want*; `source/` is what we *build*.

## Workflow

1. **Product owner** writes or updates a draft PRD in `docs/prd/<project>.md` and adds
   mockups or references in `docs/`.
2. **Claude** turns the draft into the final `source/<project>/PRD.md` and lists open questions.
3. **Product owner** reviews and marks it `Approved`.
4. **Claude / developers** build in `source/<project>/`. Big technical choices (language,
   database, vendors) are written up as ADRs in `docs/decisions/` and approved first.

Skills follow the same path: draft in `docs/skills/<project>/`, final in
`source/<project>/.claude/skills/<skill-name>/SKILL.md`.

## Key decisions so far

| Topic | Status |
|---|---|
| Event capture from Khanza | Recommended: log-based CDC (reads MariaDB binlog, no Khanza change). Pending ADR-0001 |
| Tech stack per project | Not decided — one ADR per choice |
| E-signature provider | Hospital to choose a certified provider (PSrE) |

## Data protection

This project handles patient medical records. Never commit real patient data, credentials,
or database dumps with data. Use synthetic test data only. See the rules in `CLAUDE.md`.
