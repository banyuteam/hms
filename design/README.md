# design — plan & design of each project

Final PRDs, final skills, open questions, research and design documents (Figma links, design
tokens, wireframe/mockup notes). **No code here** — code lives in [`../source/`](../source/);
your own references and PRD drafts live in [`../docs/`](../docs/).

| Group / project | Status of the plan/design | Code |
|---|---|---|
| [`hms_web-frontend-UIUX/web-workspace`](hms_web-frontend-UIUX/web-workspace/) | Design v0.1 in Figma, tokens + 2 skills, tracked open questions; PRD still a stub | [`source/…/web-workspace`](../source/hms_web-frontend-UIUX/web-workspace/) |
| [`hms_web-frontend-UIUX/web-datatooling`](hms_web-frontend-UIUX/web-datatooling/) | Stub PRD (was `data-warehouse`) | [`source/…/web-datatooling`](../source/hms_web-frontend-UIUX/web-datatooling/) |
| [`hms_services/event-streaming`](hms_services/event-streaming/) | Stub PRD; ADR-0001 (CDC query polling) proposed | [`source/…/event-streaming`](../source/hms_services/event-streaming/) |
| [`hms_services/api-gateway`](hms_services/api-gateway/) | Stub PRD (was `medical-records-api`) | [`source/…/api-gateway`](../source/hms_services/api-gateway/) |
| [`hms_services/domain-services`](hms_services/domain-services/) | Stub PRD (was `backend-services`; draft `docs/prd/002-Backend-Services.md` received, incomplete) | [`source/…/domain-services`](../source/hms_services/domain-services/) |
| [`hms_services/ai-claim-assistant`](hms_services/ai-claim-assistant/) | Stub PRD (was `claim-assistant`) | [`source/…/ai-claim-assistant`](../source/hms_services/ai-claim-assistant/) |
| [`hms_services/sso`](hms_services/sso/) | New, stub PRD | [`source/…/sso`](../source/hms_services/sso/) |
| [`hms_database`](hms_database/) | Stub PRD; ADR-0004 (PostgreSQL 18) proposed | [`source/hms_database`](../source/hms_database/) |

Each project folder has `README.md` (index), `PRD.md`, `.claude/skills/` and, where useful, `CLAUDE.md`
and design documents. `source/<group>/<project>/.claude/skills` is a symlink to `design/<group>/<project>/.claude/skills`.
Cross-cutting ADRs stay in `docs/decisions/`.
