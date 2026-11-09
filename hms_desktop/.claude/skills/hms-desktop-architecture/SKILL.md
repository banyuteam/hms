---
name: hms-desktop-architecture
description: Govern the architecture and project boundaries of the Rust-based HMS desktop client hosted around the existing React HMS workspace.
---
# HMS Desktop Architecture

## Mission
Build a cross-platform desktop client for Windows, macOS and Linux that adds native workstation capabilities while reusing the existing HMS web experience.

## System boundaries
- `hms_workspace`: React/TypeScript UI, design system, navigation, workflow UX and API client.
- `hms_desktop`: Rust native runtime, WebView host, native bridge, device access, local secure capabilities, background agents and packaging.
- `hms_services`: authentication, authorization, business rules, workflow orchestration, authoritative job state and integrations.
- `hms_database`: schemas, migrations, constraints and data governance.

Never let the desktop connect directly to PostgreSQL or legacy MySQL. Do not duplicate backend business rules in Rust.

## Architecture principles
- Thin native shell; rich web application.
- Native capabilities exposed through narrow typed interfaces.
- Backend remains authoritative.
- Least privilege and secure-by-default behavior.
- Offline capability is explicit per workflow and data class.
- Independent lifecycle for UI, native runtime and background agents.
- Platform abstractions with documented platform-specific adapters.
- Incremental delivery; no wholesale rewrite of existing HMS UI.

## Framework decision
Use Rust + WebView as the architectural direction. Inspect existing ADRs, repository dependencies, plugin ecosystem, WebView requirements, licensing, update model and target OS constraints before choosing a framework such as Tauri. Record the decision in an ADR. Do not silently add multiple competing shells.

## Capability architecture
Group native capabilities behind modules such as:
- `window`
- `printing`
- `device`
- `filesystem`
- `notification`
- `secure_storage`
- `workstation`
- `connectivity`
- `updates`
- `background`

Each module owns its validation, permission checks, platform adapter and tests.

## Cross-project changes
Before changing an API or shared type:
1. Identify the owning project.
2. Inspect existing contracts and conventions.
3. Propose a versioned interface.
4. Update all affected projects in one change plan.
5. Add compatibility and integration tests.
6. Record material decisions in the canonical `hms/` ADR location.

## Non-goals
Do not rebuild the HMS screens with native widgets. Do not implement a new authorization system, direct database client, unrestricted plugin runtime or arbitrary script execution.
