# event-streaming — plan & design

**Requirement:** #2  
**Status:** Stub PRD — waiting for the product owner's draft

Publishes the changes captured by [`cdc-polling`](../../../source/hms_services/cdc-polling/) (its `cdc.change_event` outbox) as events for the other projects, and translates them to domain events.

This folder holds the *plan and design* of the project. The code lives in [`source/hms_services/event-streaming/`](../../../source/hms_services/event-streaming/).

| | |
|---|---|
| Final PRD | [`PRD.md`](PRD.md) |
| Skills | [`.claude/skills/`](.claude/skills/) |
| Code | [`source/hms_services/event-streaming/`](../../../source/hms_services/event-streaming/) |
| Product owner's inputs | [`docs/`](../../../docs/) (PRD drafts in `docs/prd/`, mockups, references) |
