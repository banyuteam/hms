# ADR-DSK-003: Windows packaging, signing and updates

- Status: Proposed (open owner decisions D1–D5 below)
- Date: 2026-11-09
- Owners: hms_desktop
- Affected projects: hms_desktop (owner); hospital IT / workstation management (deployment); root workspace
  (release checklist)
- Related: ADR-DSK-001 §4 (packaging owned here, required before any distributed build); ADR-DSK-002 §3 (machine-wide
  configuration writable only by administrators); `deployment/RELEASE-CHECKLIST.md`

## Context
ADR-DSK-001 chose wry + tao, which ship no installer, signing or updater. No HMS Desktop build may leave a developer
machine until this is decided. Facts established on 2026-11-09:

- Target: Windows 11 x64 first; Evergreen WebView2 runtime present there (tested with 157).
- Release binary: one self-contained `hms-desktop.exe` (~3.4 MB); no other files at runtime. The startup page is
  embedded.
- Runtime files: configuration `%ProgramData%\HMS Desktop\config.toml` (machine-wide); WebView2 profile
  `%LOCALAPPDATA%\HMS Desktop\WebView2` (per user).
- **Configuration is not protected today.** Default `C:\ProgramData` permissions let any standard user create
  folders and files (`BUILTIN\Users:(CI)(WD,AD,…)`) and give the creator full control (`CREATOR OWNER:(F)`). The
  `HMS Desktop` folder does not exist until something creates it, so a non-administrator could create
  `config.toml` and point the shell — and its bridge — at a look-alike site. ADR-DSK-002 §3 assumes administrators
  alone can write it; nothing enforces that yet.
- Tooling on the build workstation: WiX Toolset 7.0.0 (requires accepting its EULA via `wix eula`), .NET SDK,
  Windows SDK 10.0.26100 (`signtool`). No CI pipeline exists in the workspace, and `hms_desktop` is not under source
  control. (Superseded the same day: `hms_desktop` now lives in the workspace repository, ADR-ROOT-001.)
- Hospital workstations are expected to be managed by IT; the actual management tool (Intune, Configuration
  Manager, Group Policy, manual) is not yet known.

## Decision
1. **Package format: one per-machine x64 MSI** built with the WiX Toolset from source in
   `packaging/windows/` (`hms-desktop-<version>-x64.msi`). It installs only:
   - `%ProgramFiles%\HMS Desktop\hms-desktop.exe` (inherited Program Files permissions: administrators write,
     users read/execute);
   - a Start-menu shortcut "HMS";
   - the folder `%ProgramData%\HMS Desktop\` with **explicit, non-inherited permissions**: SYSTEM and
     Administrators full control, Users read only. No `CREATOR OWNER` entry.

   It installs no service, scheduled task, autostart entry, URL protocol, firewall rule, driver or second
   executable.
2. **Configuration is deployed by IT, not built into the MSI.** Two supported ways: an MSI property at install
   (`msiexec /i … HMS_ORIGIN=https://hms.example.internal`), written by the installer as `config.toml` only if no file
   exists and never overwritten or removed by upgrade or uninstall; or a file pushed by the management tool. The MSI
   never contains a production origin.
3. **The shell enforces the protection.** At startup, before reading `config.toml`, the shell checks that neither
   the file nor its folder grants write, delete or ownership rights to any principal other than SYSTEM,
   Administrators or TrustedInstaller. It also checks that the file is owned by one of those, and is not a reparse
   point (symlink/junction). If any check fails, the shell shows `config-invalid` and loads nothing. Debug builds
   reading `HMS_DESKTOP_CONFIG` skip this check and log that they did.
4. **Signing.** `hms-desktop.exe` and the MSI are Authenticode-signed (SHA-256) and RFC 3161 timestamped. The
   private key is held in an HSM-backed signing service or token and never leaves it. It is never stored in this
   repository, on a developer laptop, or in CI variables as a file. Signing happens only in the release pipeline.
   Unsigned builds are labelled `dev` in their version metadata and are not given to clinical workstations.
5. **Updates are delivered by IT as new MSIs (major upgrade); the shell has no auto-updater in this version.**
   - Stable `UpgradeCode`, generated once and recorded in `packaging/windows/`; each release is a major upgrade.
   - Downgrades are blocked by the MSI. Rollback = uninstall, then install the previous signed MSI; configuration is
     preserved (§2).
   - IT stages rollout in rings (IT test machines → one pilot unit → all).
   - A self-updater (signed manifest, Authenticode check, staged rollout, no WebView-supplied URLs) needs its own
     ADR. Revisit when background agents or local job queues exist, because those constrain when an update may run.
6. **WebView2: Evergreen runtime required, not bundled.** The MSI has a launch condition that blocks install with a
   clear message if the Evergreen runtime is not registered (per-machine or per-user `EdgeUpdate` client key). IT
   installs the Evergreen Standalone Installer on machines that lack it. A Fixed Version runtime is not shipped: it
   would make HMS Desktop responsible for patching Chromium.
7. **Versioning.** `Cargo.toml` `version` is the single source. The MSI `ProductVersion` is `major.minor.patch`
   (MSI limits: major, minor ≤ 255; patch ≤ 65535). The bridge `runtime.get_info` reports the same version. Each
   release records version, source revision, toolchain (`rust-toolchain.toml`), WiX version and SHA-256 of both
   artifacts.
8. **Build and supply chain.** Release artifacts are built only from a clean, tagged source revision, by a Windows
   CI runner:
   - build with `cargo build --release --locked`;
   - `cargo fmt --check`, `cargo clippy -D warnings` and `cargo test` must pass first;
   - scan dependencies against the RustSec advisory database and check licences, failing on unreviewed findings;
   - generate a CycloneDX SBOM from `Cargo.lock`;
   - publish SHA-256 checksums.

   Tool versions are pinned in the pipeline definition.
9. **Uninstall.** Removes the executable and shortcut. Keeps `%ProgramData%\HMS Desktop\` (IT-owned configuration)
   and per-user WebView2 profiles: a per-machine MSI cannot reliably clean every user's profile. IT gets a
   documented cleanup script for decommissioned or shared workstations.

## Open owner decisions
- **D1 Signing identity**: a public code-signing certificate through a managed signing service (works on
  unmanaged machines, SmartScreen reputation), or an internal enterprise PKI code-signing certificate trusted by Group
  Policy (no external cost; requires AD CS and managed machines only). Publisher name to appear in the signature.
- **D2 Distribution channel**: Intune, Configuration Manager, Group Policy software installation, or manual
  `msiexec` by IT. Affects §2 (how configuration is pushed) and §5 (rollout rings).
- **D3 Source control and CI**: `hms_desktop` must be in a repository with a Windows runner able to reach the signing
  service before §4 and §8 can be met. Source control decided 2026-11-09: the workspace repository (ADR-ROOT-001).
  The Windows CI runner is still open.
- **D4 WiX licence — decided 2026-11-09**: the owner confirmed the organisation accepts the WiX 7 Open Source
  Maintenance Fee (OSMF) EULA. Builds accept it per invocation (`build-msi.ps1 -AcceptWixEula` →
  `wix build --acceptEula wix7`); no acceptance file is stored. Meeting any fee obligation under the OSMF terms remains
  with the organisation.
- **D5 Windows 10**: support it (needs WebView2 deployment there and a test machine) or declare Windows 11 only.

## Alternatives considered
1. **MSIX**: modern, signed by design. But the packaged-app container virtualizes per-user writes and complicates
   the machine-wide ProgramData configuration. Sideloading needs policy on every machine. Rejected for now.
2. **Per-user MSI or EXE installer (NSIS, Inno Setup)**: installs without admin rights. But a standard user could
   then replace the binary or its configuration, defeating ADR-DSK-002 §3, and EXE installers fit enterprise
   deployment tools less well.
3. **Built-in auto-updater now**: faster fixes. But it adds an update server, a signing-key dependency at runtime,
   and a privileged download path, before there is any local state that needs careful update timing.
4. **Bundled Fixed Version WebView2**: version-stable rendering. But it makes this project responsible for shipping
   Chromium security patches, and adds a large package.
5. **Ship configuration inside the MSI**: one artifact per environment. But the production origin would end up in
   build artifacts, and a configuration change would need a rebuild and re-sign.

## Consequences
- Positive: one signed artifact; standard enterprise deployment; only administrators can change the origin, and the
  shell verifies that; no update service to secure; WebView2 patched by Microsoft.
- Negative: updates depend on IT rollout speed; the shell cannot yet force a minimum version (a stale shell keeps
  working against a newer web app, limited by the bridge protocol version); every release needs IT action.
- Operational: IT owns installation, configuration, WebView2 runtime presence, rollout rings and rollback. HMS
  Desktop owns the MSI, signing pipeline, release notes and the IT runbook (`packaging/windows/README.md`).
- Compatibility: per-machine install requires administrator rights. Existing developer runs (`cargo run`,
  `HMS_DESKTOP_CONFIG`) are unaffected.
- Security/privacy: closes the ProgramData configuration-planting gap; keys stay in an HSM; SBOM and advisory scan per
  release. Residual: per-user WebView2 profiles persist after uninstall (cookies expire server-side, ADR-SVC-001);
  unsigned dev builds must not reach clinical machines (procedural control).
- Patient-safety: no direct effect; a failed install or upgrade leaves the previous version or none, never a
  partially configured shell pointing elsewhere.

## Ownership impact
`hms_desktop` implements §1–§9 and the IT runbook. Hospital IT deploys and configures. The root workspace adds a
"Desktop release" section to `deployment/RELEASE-CHECKLIST.md`. `hms_services`, `hms_database` and `hms_workspace`
are unaffected.

## Migration and rollout
No HMS Desktop is installed anywhere yet; nothing to migrate.
1. Implement §3 (configuration permission check) in the shell with tests.
2. Add `packaging/windows/` (WiX source, UpgradeCode, IT runbook) and build an unsigned `dev` MSI locally.
3. Install/upgrade/uninstall tests on a clean Windows 11 VM.
4. After D1–D4: CI pipeline with signing, SBOM and scans; first signed pilot release to IT test machines only.

## Implementation status (2026-11-09)
- §3 implemented in `src/protection.rs`; `config.toml` format became `[hms]` / `origin = …` so the installer can
  write it with the INI API.
- §1, §2, §6, §7, §9: `packaging/windows/hms-desktop.wxs` + `build-msi.ps1` produce an unsigned dev MSI. It passes WiX
  ICE validation, with one informational ICE69 warning: the shortcut targets a file in another component of the same
  feature. Its tables were checked read-only: `ALLUSERS=1`, the launch conditions, `MsiLockPermissionsEx` SDDL on the
  config folder, the conditional `IniFile` row, and the WebView2 registry searches. **Not yet installed anywhere.**
- Not started: §4 signing, §8 pipeline (D1–D3).

## Acceptance criteria
- [x] Shell refuses a `config.toml` that a standard user can write, delete or owns, or whose folder grants them
      create/write rights, or that is a reparse point. Covered by tests with real ACLs on a temporary folder.
- [x] The installer's SDDL (read from the WiX source) passes the shell's check when applied to a real folder and
      inherited by a file; weakening it fails the test.
- [ ] Clean Windows 11 VM: silent install (`msiexec /i … /qn`), with and without `HMS_ORIGIN`, creates the folder with
      the specified permissions (verified with `icacls`); a standard user cannot create or modify `config.toml`.
- [ ] Install is blocked with a clear message when the WebView2 runtime is absent.
- [ ] Upgrade N-1 → N keeps configuration; downgrade is refused; uninstall keeps configuration and removes the binary
      and shortcut.
- [ ] `signtool verify /pa /all` passes for exe and MSI; timestamps present; a modified MSI fails verification.
- [ ] Release record contains version, source revision, toolchain, WiX version, SHA-256s, SBOM and advisory scan
      result.
- [ ] `deployment/RELEASE-CHECKLIST.md` has a Desktop release section referencing these checks.
