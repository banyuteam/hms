# database — plan & design

**Requirement:** #3  
**Status:** Stub PRD — waiting for the product owner's draft

PostgreSQL 18 (ADR-0004, proposed): databases for the domain microservices, plus the ICD-10 & ICD-9-CM catalogue. Never the Khanza database.

This folder holds the *plan and design* of the project. The code lives in [`source/hms_database/`](../../source/hms_database/).

| | |
|---|---|
| Final PRD | [`PRD.md`](PRD.md) |
| Skills | [`.claude/skills/`](.claude/skills/) |
| Code | [`source/hms_database/`](../../source/hms_database/) |
| Product owner's inputs | [`docs/`](../../docs/) (PRD drafts in `docs/prd/`, mockups, references) |

First schema in progress: [`source/hms_database/cdc-polling/`](../../source/hms_database/cdc-polling/) for the cdc-polling service; its plan is [`design/hms_services/cdc-polling/BUILD-PLAN.md`](../hms_services/cdc-polling/BUILD-PLAN.md).
