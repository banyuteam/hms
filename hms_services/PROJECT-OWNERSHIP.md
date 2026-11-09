# hms_services Ownership

Owns Go runtime, APIs, business workflows, transaction boundaries, authentication/authorization enforcement, configuration loading and policy distribution, security telemetry/detection/response, eventing, integrations, legacy polling execution, AI orchestration, Python DSL compilation, typed IR validation, UI data-source resolution, registered UI action execution and observability.

Python is used for trusted DSL authoring and approved isolated workers. Go remains the runtime and authorization authority.

Does not own PostgreSQL schema migrations, React design system, frontend rendering, Android/iOS UI or workspace Compose topology.
