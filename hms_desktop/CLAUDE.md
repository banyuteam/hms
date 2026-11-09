# HMS Desktop — Project Instructions

## Project identity
`hms_desktop` is the native workstation runtime and desktop client for the Hospital Management System. It complements `hms_workspace`; it does not replace it.

## Top-level workspace
This project lives in the `hms/` workspace repository (ADR-ROOT-001) alongside:
- `hms_workspace/` — React/TypeScript web, Android and iOS clients; canonical design system.
- `hms_services/` — Go backend and authoritative business workflows.
- `hms_database/` — PostgreSQL schemas, migrations and data governance.

Read the top-level `../CLAUDE.md` and relevant sibling project instructions before changing shared interfaces.

## Core architecture
- Rust owns the native desktop runtime, OS integration, device access, secure local capabilities, background-agent lifecycle and packaging.
- The existing React/TypeScript HMS UI and design system remain owned by `hms_workspace`.
- The desktop hosts the approved web application in a WebView.
- A narrow, typed, allowlisted bridge connects web UI to native capabilities.
- Go services own authentication, authorization, business rules, sensitive operations and authoritative workflow state.
- PostgreSQL and legacy MySQL are accessed only through approved backend services. Desktop must never connect directly to either database.

## Preserve existing behavior
- Do not redesign or duplicate existing HMS screens.
- Reuse canonical design tokens and components from `hms_workspace`.
- Do not fork UI components into this project unless they are genuinely desktop-shell-specific.
- Make incremental changes and preserve existing workflows.

## Framework selection
The native direction is Rust + WebView for Windows, macOS and Linux. Before selecting or changing a specific framework, inspect current workspace decisions, existing dependencies and platform requirements. Record an ADR. Do not silently add a second desktop framework.

## Security invariants
- Never expose arbitrary shell commands, filesystem paths, SQL, dynamic function names or unrestricted native invocation to the WebView.
- Every bridge command is typed, bounded, validated and allowlisted.
- Native capabilities follow least privilege and explicit permission grants.
- Backend authorization remains authoritative.
- Treat WebView messages, local files, device input and local state as untrusted.
- Do not store secrets or PHI in plaintext.
- Do not make all clinical records available offline by default.
- Audit sensitive operations and minimize PHI in logs and telemetry.

## Implementation discipline
1. Inspect the existing repository before editing.
2. Identify the owning project for every change.
3. Define interfaces before implementing cross-process communication.
4. Add tests for normal, failure, boundary and security behavior.
5. Document platform-specific limitations.
6. Update ADRs and setup instructions when architecture changes.
7. Report files changed, commands/tests run, packaging impact and known limitations.

## Definition of done
A desktop feature is complete only when its permission model, bridge contract, failure behavior, platform support, logging/privacy impact, tests and release implications are addressed.
