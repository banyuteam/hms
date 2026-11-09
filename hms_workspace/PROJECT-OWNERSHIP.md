# hms_workspace Ownership

Owns web, Android and iOS user experience; React design system; AppShell and workflow instances; explicit assistant context selection; API clients; and the web UI IR renderer.

Web may render approved declarative UI IR through a typed component registry mapped to the existing Banyumanik 2 design system. It never executes Python, arbitrary JavaScript or SQL and never connects directly to PostgreSQL.

Android and iOS remain focused native clients for explicitly approved mobile capabilities, not full replicas of the web app.

Does not own backend business rules, authorization authority, database schemas, runtime security enforcement or Python UI compilation.
