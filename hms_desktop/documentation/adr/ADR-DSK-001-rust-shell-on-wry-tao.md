# ADR-DSK-001: Native desktop shell built directly on wry + tao

- Status: Proposed (owner decision 2026-11-09 recorded below; awaiting acceptance after the first vertical slice)
- Date: 2026-11-09
- Owners: hms_desktop
- Affected projects: hms_desktop (owner); hms_workspace (hosted UI, future bridge consumer); hms_services (unchanged)
- Related contracts: `contracts/bridge/desktop-bridge-v1.md`; ADR-DSK-002 (UI loading); ADR-SVC-001 (sign-in and sessions)

## Context
`hms_desktop` must host the existing React HMS workspace in a system WebView and add native workstation capabilities
(printing, devices, secure storage, background agents) through a narrow typed bridge. The project CLAUDE.md fixes the
direction as Rust + WebView on Windows, macOS and Linux and forbids a second desktop framework. No desktop code,
dependency or ADR existed before this decision (repository inspected 2026-11-09).

## Decision
1. The shell is a single Rust binary built directly on **tao** (windowing, event loop) and **wry** (system WebView:
   WebView2 on Windows, WKWebView on macOS, WebKitGTK on Linux). No higher-level framework (Tauri, Electron) is added.
2. Because wry has no permission or command system, `hms_desktop` owns these explicitly:
   - one IPC entry point (`window.ipc.postMessage`) that accepts only the versioned bridge envelope
     (`contracts/bridge/desktop-bridge-v1.md`);
   - a static command table: each command has a fixed ID, the origins allowed to call it, typed arguments and bounded
     size; anything else is rejected with a structured error;
   - replies are delivered only to the document that asked (document generation check).
3. Capabilities live in separate Rust modules (`config`, `navigation`, `connectivity`, `bridge`, `startup`, later
   `printing`, `device`, `secure_storage`, …). Policy logic is pure and unit-tested; tao/wry wiring stays in `app.rs`.
4. Packaging, signing and updates are owned by this project and get their own ADR before the first distributed build
   (wry/tao ship no installer or updater).
5. Windows is the first supported target (owner decision 2026-11-09). macOS and Linux code paths must compile from the
   same source but are untested until CI runners exist.

## Alternatives considered
1. **Tauri 2**: built on wry/tao with a ready capability/permission system, plugin ecosystem, bundler and signed
   updater. Not chosen by the owner: preference for direct control of the IPC surface and a smaller dependency tree.
   Cost: we must build and test IPC policy, packaging and updates ourselves.
2. **Electron**: bundles Chromium and a Node runtime; contradicts the Rust + WebView direction and adds a large
   privileged JavaScript runtime.
3. **Native Rust UI (egui, Slint, Dioxus native)**: would rebuild HMS screens natively, a non-goal.

## Consequences
- Positive: smallest privileged surface; every native entry point is visible in this repository; no third-party
  plugin model to govern.
- Negative: no off-the-shelf bundler, updater, single-instance, deep-link or tray plugins; each needs a design,
  implementation and tests here. Upgrades of wry/tao must be tracked manually (both pre-1.0, breaking API changes are
  common between minor versions).
- Operational: Windows requires the Evergreen WebView2 runtime (present on Windows 11; the installer must check or
  bootstrap it on Windows 10). WebView2 user data is placed in the per-user local app-data directory, never next to
  the executable.
- Compatibility: the shell is independent of the web release cadence except for the bridge protocol version.
- Security/privacy: we own IPC validation entirely; every command needs a threat model and tests
  (`.claude/skills/hms-desktop-native-bridge-security`).
- Patient-safety: none directly; the shell does not change clinical workflows or authorization.

## Ownership impact
`hms_desktop` owns the runtime, bridge, packaging and updates. `hms_workspace` remains the owner of all UI and will
consume the bridge through its own adapter. `hms_services` remains the only authority for sign-in and authorization.

## Migration and rollout
No existing desktop deployment. The first slice runs from source on developer machines only. A move to Tauri later
remains possible because both use the same WebView layer; the bridge contract is framework-neutral.

## Acceptance criteria
- [ ] `cargo build`, `cargo test`, `cargo clippy -- -D warnings` and `cargo fmt --check` pass on Windows.
- [ ] Shell opens the configured HMS origin; navigation to any other origin is denied (tested).
- [ ] Bridge rejects unknown commands, wrong origins, malformed and oversized messages (tested).
- [ ] Packaging/signing/update ADR written before any build is distributed.
