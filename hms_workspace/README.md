# hms_workspace

User-facing experience project for HMS:
- `web/`: complete HMS operating environment using the existing web UI as its design baseline.
- `android/`: native Kotlin client for approved mobile workflows.
- `ios/`: native Swift client for approved mobile workflows.
- `contracts/`: client-facing shared contracts and platform capability declarations.
- `shared/`: platform-neutral design tokens, terminology and generated API/domain types where appropriate.

Do not assume a monorepo package manager or force a new toolchain before inspecting the existing repository. Existing web application code may be migrated into `web/` incrementally.
