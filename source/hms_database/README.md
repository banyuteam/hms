# database

**Requirement:** #3  
**Status:** In progress — `cdc-polling/` schema (draft); other services waiting for PRD

Schemas and migrations for the new services' own databases. Never the Khanza database.

| | |
|---|---|
| Final PRD & plan | [`design/hms_database/PRD.md`](../../design/hms_database/PRD.md) — stub |
| Skills | [`design/hms_database/.claude/skills/`](../../design/hms_database/.claude/skills/) |
| Claude instructions | [`CLAUDE.md`](CLAUDE.md) |

## Contents

| Folder | For | Status |
|---|---|---|
| [`cdc-polling/`](cdc-polling/) | `hms_services/cdc-polling`: control schema `cdc` + `khanza_mirror` tables | Draft (ADR-0004/0005 proposed) |

## How to run

Per folder; see each folder's README. The migration tool is not decided yet.
