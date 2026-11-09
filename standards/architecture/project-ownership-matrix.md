# Project Ownership Matrix

| Capability / artifact | Root workspace | hms_database | hms_services | hms_workspace |
|---|---|---|---|---|
| High-level architecture and ADRs | Accountable | Consulted | Consulted | Consulted |
| PostgreSQL schemas and migrations | Governance | Owns | Consumer | No direct access |
| Database connection runtime | Deployment conventions | Schema/role guidance | Owns Go pools and repositories | No DB connection |
| IAM and authorization runtime | Standards | Owns IAM persistence schema | Owns enforcement | UI only |
| Runtime configuration engine | Standards | Owns policy/config persistence | Owns loader, validation and reload | Admin UI only |
| Threat detection | Security standards | Owns durable event/incident schemas | Owns collection, detection and response | Security Center UI |
| Python domain DSL | Contract governance | Owns persisted contracts if applicable | Owns authoring/compiler/runtime | No Python execution |
| Python UI DSL | IR contract governance | Owns `ui_platform` schema | Owns DSL/compiler/Go runtime | Consumes IR |
| UI IR contract | Owns cross-project contract | Validates persistence impact | Produces and validates | Consumes and renders |
| React renderer | Standards | None | Serves approved definitions | Owns renderer |
| Design system | Shared governance | None | No visual ownership | Owns implementation |
| Workflow engine | Standards | Owns workflow persistence | Owns execution | Presents workflow |
| Assistant context | Contract governance | Owns relevant references where needed | Resolves and authorizes | Explicit selection |
| Legacy MySQL | Read-only policy | Inventory and mapping docs | SELECT-only polling execution | No access |
| Docker orchestration | Owns workspace Compose | Migration guidance | Service images | Web image |
| Android/iOS | Mobile standards | No direct access | APIs and authorization | Owns native clients |

## Conflict resolution
When responsibilities overlap, preserve these rules:
1. Data definitions and migrations are owned by `hms_database`.
2. Runtime behavior and authorization are owned by `hms_services`.
3. User experience and client state are owned by `hms_workspace`.
4. Cross-project contracts and deployment coordination are owned at the root.
5. A project must not silently modify another project's owned artifacts. Propose a coordinated change and update the contract/ADR.
