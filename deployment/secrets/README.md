# Development secret files

Everything in this folder except this README and `.gitkeep` is git-ignored. `compose.yaml` reads six files from
`secrets/dev/` (or `HMS_SECRETS_DIR`), one value per file, no trailing spaces:

| File | Value |
|---|---|
| `postgres_superuser_password` | Password of the container's `postgres` superuser (used only by `db-bootstrap`) |
| `hms_migrator_password` | Password set for `hms_meta_migrator` (used only by `db-migrate`) |
| `hms_runtime_password` | Password set for `hms_meta_runtime` (`org-setup`, `hms-services`) |
| `legacy_db_password` | Password of the SELECT-only Khanza account |
| `legacy_login_id_key` | Khanza AES key for `user.id_user` |
| `legacy_login_password_key` | Khanza AES key for `user.password` |

With the document understanding overlay (`compose.documents.yaml`), two more:

| File | Value |
|---|---|
| `ai_bridge_secret` | Shared secret between `hms-services` and `hms-ai-bridge`, at least 32 characters (generate it like the passwords) |
| `anthropic_api_key` | Anthropic API key of the zero-data-retention organization (ADR-SVC-009 D-3); may be empty in development (the bridge then reports not configured). Never commit it, never paste it into an issue or chat |

Use development values only. Production secrets come from the approved secret manager, never from this folder.
See `deployment/README.md` for commands that create the files.
