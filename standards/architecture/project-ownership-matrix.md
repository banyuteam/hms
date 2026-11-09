# Project Ownership Matrix

| Capability / artifact | Root workspace | hms_database | hms_services | hms_workspace | hms_desktop |
|---|---|---|---|---|---|
| High-level architecture and ADRs | Accountable | Consulted | Consulted | Consulted | Consulted |
| PostgreSQL schemas and migrations | Governance | Owns | Consumer | No direct access | No direct access |
| Database connection runtime | Deployment conventions | Schema/role guidance | Owns Go pools and repositories | No DB connection | No DB connection |
| IAM and authorization runtime | Standards | Owns IAM persistence schema | Owns enforcement | UI only | Hosts web sign-in; no enforcement |
| Runtime configuration engine | Standards | Owns policy/config persistence | Owns loader, validation and reload | Admin UI only | Workstation config only |
| Threat detection | Security standards | Owns durable event/incident schemas | Owns collection, detection and response | Security Center UI | None yet |
| Python domain DSL | Contract governance | Owns persisted contracts if applicable | Owns authoring/compiler/runtime | No Python execution | No Python execution |
| Python UI DSL | IR contract governance | Owns `ui_platform` schema | Owns DSL/compiler/Go runtime | Consumes IR | None |
| UI IR contract | Owns cross-project contract | Validates persistence impact | Produces and validates | Consumes and renders | None |
| React renderer | Standards | None | Serves approved definitions | Owns renderer | Hosts web app; no renderer |
| Design system | Shared governance | None | No visual ownership | Owns implementation | Reuses tokens; no fork |
| Workflow engine | Standards | Owns workflow persistence | Owns execution | Presents workflow | None |
| Assistant context | Contract governance | Owns relevant references where needed | Resolves and authorizes | Explicit selection | None |
| Legacy MySQL | Read-only policy | Inventory and mapping docs | SELECT-only polling execution | No access | No access |
| Docker orchestration | Owns workspace Compose | Migration guidance | Service images | Web image | Not containerized |
| Android/iOS | Mobile standards | No direct access | APIs and authorization | Owns native clients | None |
| Desktop shell, native bridge and packaging | ADR governance (ADR-ROOT-001) | No direct access | Authentication and authorization unchanged | Hosted UI; future bridge consumer | Owns |

## Conflict resolution
When responsibilities overlap, preserve these rules:
1. Data definitions and migrations are owned by `hms_database`.
2. Runtime behavior and authorization are owned by `hms_services`.
3. User experience and client state are owned by `hms_workspace`; the desktop runtime and native bridge are owned by `hms_desktop`.
4. Cross-project contracts and deployment coordination are owned at the root.
5. A project must not silently modify another project's owned artifacts. Propose a coordinated change and update the contract/ADR.
