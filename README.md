# HMS Desktop

Native workstation shell for HMS: a Rust binary (tao + wry) that hosts the existing HMS web workspace in the system
WebView and will add native capabilities through a narrow, typed bridge. It does not contain HMS screens, business
rules, authorization or database access.

**Status: development-ready only (vertical slice 1).** Not packaged, signed, or tested on macOS/Linux. Not for
distribution.

## Decisions and contracts
- [ADR-DSK-001](documentation/adr/ADR-DSK-001-rust-shell-on-wry-tao.md): wry + tao, no Tauri/Electron; Windows first.
- [ADR-DSK-002](documentation/adr/ADR-DSK-002-hybrid-ui-loading.md): packaged startup page, then the hosted HMS origin;
  sign-in unchanged (ADR-SVC-001).
- [ADR-DSK-003](documentation/adr/ADR-DSK-003-windows-packaging-signing-updates.md): per-machine signed MSI,
  IT-delivered updates, Evergreen WebView2, locked-down configuration folder (Proposed; owner decisions open).
- [Bridge protocol v1](contracts/bridge/desktop-bridge-v1.md).

## How it works
1. Reads the machine-wide config (`%ProgramData%\HMS Desktop\config.toml`, see
   [example](config/hms-desktop.example.toml)). One exact HMS origin, `https` required (release builds). The file is
   used only if administrators alone can have written it.
2. Shows the packaged startup page (`https://hmsdesktop.localhost/` on Windows, served from memory, strict CSP).
3. Probes `GET <origin>/healthz` (OS trust store, 5 s, no redirects). 2xx → loads the hosted origin; otherwise shows
   "server unreachable" / "server error" with a retry button. Missing/invalid config shows its own state.
4. Only the startup page and the hosted origin can load as top-level documents. New windows, downloads and web
   permission requests (camera, microphone, notifications, …) are denied. Logs record origins only, never paths.

## Layout
| Path | Purpose |
|---|---|
| `src/app.rs` | tao/wry wiring only (window, WebView, event loop) |
| `src/config.rs`, `src/paths.rs` | configuration loading/validation; platform directories |
| `src/protection.rs` | configuration file/folder owner and ACL check (ADR-DSK-003 §3) |
| `packaging/windows/` | WiX source, dev MSI build script, IT runbook |
| `src/origin.rs`, `src/navigation.rs` | exact-origin model; navigation and caller policy |
| `src/bridge/` | bridge envelope, command allowlist, `runtime.*`/`startup.*` commands, injected client |
| `src/connectivity.rs` | hosted-origin health probe |
| `src/startup.rs`, `startup/` | packaged startup page and its server |
| `build.rs` | generates the startup page's `tokens.css` from the canonical `hms_workspace` design tokens |

## Develop (Windows)
Prerequisites: Rust 1.99.1 (pinned in `rust-toolchain.toml`, installed by rustup), MSVC C++ build tools, Evergreen
WebView2 runtime. The design tokens are read from
`../hms_workspace/web/.claude/skills/design-tokens/references/tokens.json`; set `HMS_DESIGN_TOKENS` to use another
copy.

```powershell
cargo fmt --check
cargo clippy --all-targets -- -D warnings
cargo test
# Debug run against a local origin (http allowed only for localhost in debug builds):
$env:HMS_DESKTOP_CONFIG = "$PWD\hms-desktop.toml"   # contains: [hms] / origin = "http://127.0.0.1:5174"
$env:RUST_LOG = "hms_desktop=debug"
cargo run
```

Against the Vite dev server over HTTPS, its certificate must be trusted by Windows: the shell and WebView2 both use
the OS trust store and refuse unknown issuers.

## Platform matrix
| Platform | Status |
|---|---|
| Windows 11 x64, WebView2 157 | builds, unit tests pass, startup/unreachable/hosted flows checked manually (2026-11-09) |
| Windows 10 | untested; needs WebView2 runtime check in the installer |
| macOS, Linux | code paths compile-intended only; never built or run. Config/data paths are provisional |

## Known limitations
- Dev MSI only ([packaging/windows](packaging/windows/README.md)); no code signing, CI, single-instance guard, tray
  or menus yet.
- The shell refuses a machine-wide `config.toml` unless the file and its folder are owned by SYSTEM, Administrators or
  TrustedInstaller and writable only by them (ADR-DSK-003 §3). Without the installer, the folder does not exist, so
  the shell shows "not configured".
- Navigation policy covers top-level documents only. Subframes are not filtered by the shell; the hosted app's CSP
  (`frame-src`, owned by `hms_workspace`) governs them. Subframes cannot reach the bridge (verified on WebView2).
- Downloads are denied. If an HMS workflow needs file export, it needs a designed `filesystem` capability.
- No logging to file in release builds (the release binary has no console). Log sink and retention are open items.
- Version compatibility is one-way today: the web app can read the protocol version, but the shell cannot yet detect
  a web build it is incompatible with.
- The WebView2 profile (cookies, cache) lives in `%LOCALAPPDATA%\HMS Desktop\WebView2` per Windows user; on shared
  workstations, staff must sign out (the server also ends idle sessions after 15 min, ADR-SVC-001).
