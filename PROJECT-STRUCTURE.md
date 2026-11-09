# hms — Target Project Structure

This is the target organization for three separately owned projects coordinated by one workspace. It is a guide, not a mandate to move every existing file immediately. Inspect actual repositories and migrate incrementally.

```text
hms/
├── CLAUDE.md
├── README.md
├── PROJECT-STRUCTURE.md
├── SKILLS-CATALOG.md
├── .claude/skills/                         # cross-project governance
├── standards/
│   ├── architecture/
│   │   ├── high-level-architecture.md
│   │   ├── project-ownership-matrix.md
│   │   ├── workspace-control-plane.md
│   │   ├── shared-postgresql-platform.md
│   │   ├── runtime-configuration-and-security.md
│   │   ├── declarative-ui-engine.md
│   │   ├── web-shell-and-workflow-model.md
│   │   ├── existing-ui-preservation-and-integration.md
│   │   └── adr-template.md
│   └── contracts/
│       ├── assistant-context-reference-contract.md
│       ├── mobile-capability-registry.md
│       ├── event-envelope.md
│       ├── dsl-ir-contract.md
│       └── ui-ir-contract.md
├── deployment/
│   ├── compose.yaml
│   ├── compose.production.yaml
│   ├── environments/
│   ├── secrets/                             # references and procedures; no committed secrets
│   ├── monitoring/
│   │   ├── prometheus/
│   │   ├── grafana/
│   │   ├── loki/
│   │   └── alertmanager/
│   ├── docker/
│   ├── ENVIRONMENTS.md
│   └── RELEASE-CHECKLIST.md
│
├── hms_database/
│   ├── CLAUDE.md
│   ├── PROJECT-OWNERSHIP.md
│   ├── .claude/skills/
│   ├── schemas/
│   │   ├── platform/ iam/ security/ audit/
│   │   ├── workflow/ eventing/ integration/
│   │   ├── ai-platform/ notification/ licensing/
│   │   ├── ui-platform/ readmodel/
│   │   └── patient/ clinical/ orders/ pharmacy/ billing/ inventory/
│   ├── migrations/
│   ├── seeds/
│   ├── legacy/
│   │   ├── schema-inventory/
│   │   ├── query-catalog/
│   │   └── field-mapping/
│   ├── tests/
│   └── documentation/
│       ├── ERD/
│       ├── DATA-DICTIONARY.md
│       ├── DOMAIN-OWNERSHIP.md
│       └── DATA-GOVERNANCE.md
│
├── hms_services/
│   ├── CLAUDE.md
│   ├── PROJECT-OWNERSHIP.md
│   ├── .claude/skills/
│   ├── core/                                # Go runtime and domain orchestration
│   ├── platform/
│   │   ├── configuration/
│   │   ├── iam/
│   │   ├── security/
│   │   ├── threat-detection/
│   │   ├── workflow/
│   │   ├── notification/
│   │   └── ai-governance/
│   ├── ui-engine/
│   │   ├── python-dsl/
│   │   ├── compiler/
│   │   ├── ir/
│   │   ├── runtime/
│   │   ├── registry/
│   │   └── publication/
│   ├── dsl/                                 # existing domain DSL; keep distinct from UI DSL
│   ├── integrations/
│   ├── contracts/
│   ├── runtimes/
│   ├── infrastructure/
│   └── tests/
│
└── hms_workspace/
    ├── CLAUDE.md
    ├── .claude/skills/
    ├── web/
    │   ├── src/
    │   │   ├── app/
    │   │   ├── shell/
    │   │   ├── workflow-engine/
    │   │   ├── assistant/
    │   │   ├── engine/ui-ir/
    │   │   │   ├── renderer/
    │   │   │   ├── registry/
    │   │   │   ├── forms/
    │   │   │   └── actions/
    │   │   ├── modules/
    │   │   ├── design-system/
    │   │   ├── api/
    │   │   └── auth/
    │   └── tests/
    ├── android/                             # native Kotlin, selected capabilities
    ├── ios/                                 # native Swift, selected capabilities
    ├── contracts/
    ├── shared/
    └── documentation/
```

## Architectural interpretation
- Root workspace owns cross-project governance, contracts, Docker orchestration, release coordination and ADRs.
- `hms_database` owns schema definitions, migrations, constraints, data dictionary, ERDs and database governance.
- `hms_services` owns Go runtime behavior, authorization, workflows, integrations, security enforcement, Python DSL compilation, UI IR validation and action execution.
- `hms_workspace` owns web/mobile presentation, workflow instances, React UI IR renderer, design system and explicit assistant context selection.
- PostgreSQL may be provisioned at workspace scope, but access remains least-privilege and service-owned.
- Legacy MySQL remains external and strictly read-only.
- Existing Banyumanik 2 web UI is preserved and integrated incrementally.
- Android/iOS are focused native clients, not replicas of the web app.
