# HMS Modernization

Moving the hospital's running **SIMRS Khanza** (Java desktop app on MariaDB) to a modern web
platform, step by step, **without disrupting Khanza**. Khanza and its database keep running for
daily operations; the new platform reads its data through a change stream and grows beside it.

## What we're building

| # | Goal | Project |
|---|---|---|
| 1 | Keep Khanza and its MariaDB running unchanged | — (rule for every project) |
| 2 | Capture every database change as an event | [`source/event-streaming`](source/event-streaming/) · [`design/event-streaming`](design/event-streaming/) |
| — | Reporting data warehouse | [`source/data-warehouse`](source/data-warehouse/) |
| 3 | Web app that replicates the Khanza desktop screens | [`source/web-frontend`](source/web-frontend/), [`source/backend-services`](source/backend-services/), [`source/database`](source/database/) |
| 4 | Secure medical-records web service with e-signature | [`source/medical-records-api`](source/medical-records-api/) |
| 5 | BPJS claim assistant + ICD-10 / ICD-9-CM catalogue | [`source/claim-assistant`](source/claim-assistant/) |
| — | Contracts shared between projects | [`source/shared`](source/shared/) |

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
│   └── <project>/
│       ├── README.md      index & status of the plan/design
│       ├── PRD.md         final PRD (approved requirements)
│       ├── CLAUDE.md      how Claude works on the plan/design (when needed)
│       ├── .claude/skills/<name>/SKILL.md   final skills
│       └── … open questions, research, design notes (Figma, tokens, wireframes)
└── source/            ← 3. THE CODE (one folder per project, same name as in design/)
    └── <project>/
        ├── README.md      purpose, status, how to run
        ├── CLAUDE.md      how Claude works on the code
        ├── .claude/skills → ../../../design/<project>/.claude/skills   (symlink)
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
| Event capture from Khanza | Recommended: log-based CDC (reads MariaDB binlog, no Khanza change). Pending ADR-0001 |
| Tech stack per project | Not decided — one ADR per choice |
| E-signature provider | Hospital to choose a certified provider (PSrE) |

## Data protection

This project handles patient medical records. Never commit real patient data, credentials,
or database dumps with data. Use synthetic test data only. See the rules in `CLAUDE.md`.
