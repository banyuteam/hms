# Cross-Project Ownership Matrix

| Artifact/capability | Owner | Collaborator/consumer |
|---|---|---|
| PostgreSQL schemas and migrations | hms_database | hms_services |
| Canonical entities and persistence model | hms_database | hms_services |
| Event envelope/schema contracts | hms_database | hms_services |
| Legacy schema inventory/query catalog | hms_database | hms_services |
| Polling runtime and scheduling | hms_services | hms_database defines persistence needs |
| Change detection and mapping execution | hms_services | hms_database defines data contracts |
| Go runtime, APIs and orchestration | hms_services | hms_database provides persistence contracts |
| Python DSL and IR | hms_services | Workspace governance |
| Outbox publisher and consumers | hms_services | hms_database owns relevant schemas |
| Desktop runtime, native bridge and its contract | hms_desktop | hms_workspace consumes the bridge; hms_services remains the authorization authority |
| Shared security/healthcare standards | Workspace | All projects |

The owner changes the contract; consumers adapt through reviewed and tested changes. Breaking changes require a migration and compatibility plan.
