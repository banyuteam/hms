# design — plan & design of each project

Final PRDs, final skills, open questions, research and design documents (Figma links, design
tokens, wireframe/mockup notes). **No code here** — code lives in [`../source/`](../source/);
your own references and PRD drafts live in [`../docs/`](../docs/).

| Project | Status of the plan/design | Code |
|---|---|---|
| [`web-frontend`](web-frontend/) | Design v0.1 in Figma, tokens + 2 skills, 45 tracked questions (several decided); PRD still a stub | [`source/web-frontend`](../source/web-frontend/) |
| [`backend-services`](backend-services/) | Stub PRD (draft `docs/prd/002-Backend-Services.md` received, incomplete) | [`source/backend-services`](../source/backend-services/) |
| [`event-streaming`](event-streaming/) | Stub PRD | [`source/event-streaming`](../source/event-streaming/) |
| [`data-warehouse`](data-warehouse/) | Stub PRD | [`source/data-warehouse`](../source/data-warehouse/) |
| [`database`](database/) | Stub PRD | [`source/database`](../source/database/) |
| [`medical-records-api`](medical-records-api/) | Stub PRD | [`source/medical-records-api`](../source/medical-records-api/) |
| [`claim-assistant`](claim-assistant/) | Stub PRD | [`source/claim-assistant`](../source/claim-assistant/) |

Each `<project>/` has `README.md` (index), `PRD.md`, `.claude/skills/` and, where useful, `CLAUDE.md`
and design documents. `source/<project>/.claude/skills` is a symlink to `design/<project>/.claude/skills`.
Cross-cutting ADRs stay in `docs/decisions/`.
