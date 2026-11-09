# HMS Desktop

## 1. Project purpose

`hms_desktop/` is the native desktop client and workstation runtime for the Hospital Management System (HMS). It extends the existing HMS web experience with controlled operating-system, workstation, hardware and background-runtime capabilities.

It is a separate project within the common `hms/` engineering workspace. It is not a replacement for `hms_workspace`, and it must not become a second implementation of the HMS business UI.

The current architectural direction is a **Rust native runtime hosting the existing React/TypeScript HMS experience in a WebView**. The specific desktop framework must be selected or confirmed through repository inspection and an Architecture Decision Record (ADR).

## 2. Position in the HMS engineering workspace

```text
hms/
├── CLAUDE.md
├── hms_workspace/       # Web, Android, iOS and canonical design system
├── hms_desktop/         # Rust desktop shell, WebView host and workstation runtime
├── hms_services/        # Go backend, APIs, authorization and business workflows
├── hms_database/        # PostgreSQL schemas, migrations and data governance
├── standards/           # Cross-project governance, contracts and ADRs
└── deployment/          # Workspace deployment templates and release guidance
```

### Project ownership

| Project | Owns |
|---|---|
| `hms_workspace` | Complete HMS web operating environment, React/TypeScript UI, canonical design system, Android and iOS clients |
| `hms_desktop` | Native shell, WebView hosting, typed native bridge, workstation/device capabilities, background agents, desktop packaging and updates |
| `hms_services` | Go runtime, authentication, authorization, business rules, workflow orchestration and integration services |
| `hms_database` | Canonical persistence, PostgreSQL schemas, migrations, constraints and data integrity |
| `standards` | Cross-project architecture, shared contracts, governance and ADRs |
| `deployment` | Workspace-level container topology, environment guidance and release readiness |

Do not move existing working code merely to match this target structure. Inspect the actual repository and follow existing ownership decisions.

## 3. Relationship with hms_workspace

`hms_workspace` remains the complete HMS web operating environment and the source of truth for the established Banyumanik 2 visual design.

Desktop must reuse:
- existing branding, colors, typography and design tokens;
- existing React components and business screens;
- existing navigation, workflow and assistant behavior;
- existing API clients and shared frontend contracts where appropriate.

The desktop project may add desktop-specific shell UI and integration adapters, but it must not copy or independently maintain the HMS business UI or a parallel design system.

The web experience retains its established application shell:
- top global navigation;
- application launcher;
- workspace canvas;
- bottom workflow dock;
- persistent assistant panel.

The bottom dock represents opened workflow instances, not static module categories. Desktop windows must not silently redefine workflow identity or assistant context.

Assistant requests continue to carry explicit user-selected resource references. Active workflow state never implicitly grants assistant context. `hms_services` independently resolves and authorizes every resource reference.

## 4. Desktop capability scope

Desktop capabilities should be added where native runtime access provides meaningful value beyond a browser-only application.

### 4.1 Native application shell
- Window lifecycle, focus, resize and multi-window behavior.
- Native menus, system tray and approved keyboard shortcuts.
- OS notifications with privacy-safe content.
- Startup, shutdown, crash recovery and application lifecycle.
- Deep links only through validated routes and authorization checks.

### 4.2 Native workstation capabilities
- OS print subsystem integration and managed print queues.
- Barcode scanner and supported HID integration.
- Configured serial/RS-232 device adapters.
- Document scanner integration where supported by the OS or vendor.
- Approved local file selection and document handling.
- OS-protected credential storage.
- Workstation registration and health reporting.

### 4.3 Background runtime
- Print job execution and status reporting.
- Device connection monitoring.
- Connectivity and workstation health monitoring.
- Approved synchronization tasks.
- Application update and restart coordination.

Background agents must have an explicit lifecycle and least-privilege execution context. A WebView reload or crash must not duplicate or silently replay a side-effecting job.

### 4.4 Offline capabilities
Offline operation is not an unrestricted local copy of HMS. Each offline workflow must define:
- permitted user roles and workstation scope;
- permitted data classes and minimum data;
- encryption and local key lifecycle;
- expiry and retention;
- synchronization and conflict resolution;
- audit and reconciliation;
- behavior when authorization or connectivity is revoked.

Do not make the entire patient record database available locally by default. Do not perform sensitive actions offline unless an explicitly approved workflow defines the authority, limits and reconciliation process.

## 5. Runtime architecture

```text
┌──────────────────────────────────────────────┐
│             hms_workspace                    │
│  React UI · Design System · HMS Workflows    │
└──────────────────────┬───────────────────────┘
                       │
             Typed, allowlisted bridge
                       │
┌──────────────────────▼───────────────────────┐
│               hms_desktop                    │
│  Rust Runtime · WebView Host · Native APIs   │
│  Printing · Devices · Files · Notifications  │
│  Secure Storage · Workstation · Background  │
└──────────────────────┬───────────────────────┘
                       │ Authenticated APIs /
                       │ approved job protocols
┌──────────────────────▼───────────────────────┐
│               hms_services                   │
│  Identity · Authorization · Business Rules  │
│  Workflow · Integration · Audit              │
└──────────────────────┬───────────────────────┘
                       │
┌──────────────────────▼───────────────────────┐
│               hms_database                   │
│  PostgreSQL · Schemas · Migrations           │
└──────────────────────────────────────────────┘
```

### Runtime responsibilities

- Rust owns native OS access, device adapters, desktop lifecycle and local capability enforcement.
- React owns presentation, user interaction and HMS workflow UX.
- Go owns authoritative identity, authorization, business validation, workflow state and sensitive actions.
- PostgreSQL owns persistence and integrity.
- The legacy MySQL database remains read-only and unchanged.

Desktop must never connect directly to PostgreSQL or legacy MySQL.

## 6. Native bridge security

The WebView-to-Rust bridge is a privileged security boundary.

Every exposed command must:
- have a stable, allowlisted command identifier;
- use typed request and response DTOs;
- validate origin, schema, payload size and arguments;
- enforce capability permissions and timeouts;
- return structured errors;
- apply audit requirements where appropriate.

Never expose:
- arbitrary shell or process execution;
- arbitrary filesystem access;
- SQL or direct database operations;
- dynamic Rust function names;
- unrestricted network access;
- secrets or raw OS handles.

Native capability permission is not HMS business authorization. Backend authorization remains authoritative for user, tenant, facility, resource and workflow access.

## 7. Device and integration principles

Hardware support is device- and vendor-specific. Before implementing an adapter, confirm the device model, interface, protocol, licensing, supported operating systems and vendor documentation.

Prefer OS-standard interfaces where suitable. Keep vendor-specific behavior inside isolated adapters. Validate and normalize device data before it can enter an HMS workflow.

For clinical devices, preserve provenance, units, timestamps and device status where supplied. Invalid or incomplete device output must never silently become a finalized clinical result. Require the appropriate clinical verification workflow.

For printing, distinguish job accepted, spooled, printed and physically verified. Do not claim that paper output was observed unless the device provides that evidence.

## 8. Security, privacy and data handling

- Treat WebView messages, local files, device input and local state as untrusted.
- Use least-privilege native permissions.
- Use OS-protected secret storage where supported.
- Do not store secrets or PHI in plaintext.
- Minimize PHI in local caches, logs, crash reports and notifications.
- Apply retention, expiry and secure cleanup to local data.
- Audit sensitive operations and device/job outcomes.
- Do not bypass Go authorization or existing HMS workflow approvals.
- Do not treat workstation registration as proof that a user is authorized.

## 9. Cross-platform targets

Target operating systems:
- Windows;
- macOS;
- Linux.

Maintain a platform support matrix for each native capability, including minimum OS/runtime version, permissions, drivers, packaging dependencies and known limitations.

Do not claim feature parity until the capability has been tested on each supported platform. Account for Windows WebView runtime and installer behavior, macOS signing/notarization/entitlements, and Linux distribution/runtime/package differences.

## 10. Packaging, deployment and release

Desktop packaging is distinct from backend container deployment.

The desktop release process should cover:
- application identity and versioning;
- signed installers/packages;
- dependency and supply-chain review;
- secure update metadata and artifact verification;
- staged rollout where supported;
- interrupted update recovery;
- rollback and compatibility policy;
- local data migration;
- uninstall and workstation de-registration.

Workspace-level Docker Compose, environment and release-readiness guidance remains governed by the root `hms/` project and `deployment/`. Do not put desktop installers into backend containers unless a specific deployment design requires it.

## 11. Shared standards and instructions

Keep root `hms/CLAUDE.md` at the common engineering workspace root and this project's `CLAUDE.md` at `hms_desktop/CLAUDE.md`.

Consult the current shared standards where available:
- `standards/architecture/workspace-control-plane.md`
- `standards/architecture/shared-postgresql-platform.md`
- `standards/architecture/runtime-configuration-and-security.md`
- `standards/architecture/project-ownership-matrix.md`
- relevant API, native bridge, eventing, integration and deployment contracts.

The exact paths and contents must be verified in the actual repository. Do not assume a referenced document exists merely because it appears in this README.

Use the desktop skills under `.claude/skills/` for specialized implementation guidance. Record cross-project changes and framework choices as ADRs in the canonical engineering workspace.

## 12. Recommended implementation sequence

1. Inspect the existing `hms/` workspace, root instructions, workspace package structure and ADRs.
2. Confirm the Rust/WebView framework and record an ADR.
3. Create the minimal native shell and load the existing HMS workspace safely.
4. Establish the typed, allowlisted native bridge and version compatibility.
5. Implement workstation registration and secure runtime configuration.
6. Implement the Universal Print Agent as the first native vertical slice.
7. Add device adapters such as barcode/HID and approved serial devices.
8. Add background-agent supervision, health reporting and signed updates.
9. Expand into document scanning, additional hardware and approved offline workflows.

Do not implement every capability in one release. Deliver and validate vertical slices.

## 13. Definition of done

A desktop feature is not complete merely because it works on one developer machine. It must have:
- a documented owner and capability boundary;
- a typed bridge contract and permission model;
- backend authorization where business resources are involved;
- safe failure, timeout, retry and cancellation behavior;
- privacy and retention analysis;
- unit, integration and security tests;
- platform support evidence;
- packaging/update impact assessment;
- updated instructions and ADRs where needed.

## 14. Project status

This README describes the intended architecture and governance for `hms_desktop`. It does not claim that the desktop shell, native bridge, agents, hardware adapters, offline workflows, installers or production controls are already implemented.

Inspect the actual codebase and deployment before claiming implementation or production readiness.
