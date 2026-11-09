# hms_database Ownership

Owns PostgreSQL schema definitions, migrations, canonical domain models, constraints, indexes, ERDs, data dictionaries, database roles guidance, retention and data governance.

Includes shared platform persistence schemas (`platform`, `iam`, `security`, `audit`, `workflow`, `eventing`, `integration`, `ai_platform`, `notification`, `licensing`, `ui_platform`, `readmodel`) only when approved and assigned an owner.

Does not own Go runtime behavior, authentication/authorization enforcement, Python compiler implementation, polling execution, broker clients, UI rendering or deployment orchestration.

Legacy MySQL remains external and strictly read-only.
