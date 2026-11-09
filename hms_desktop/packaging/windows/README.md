# HMS Desktop — Windows packaging (ADR-DSK-003)

**Development builds only.** `build-msi.ps1` produces an unsigned MSI for test machines. Signed releases need owner
decisions D1–D3 (signing identity, distribution channel, CI runner) and the release pipeline. D4 (WiX licence) is
decided; source control is settled by ADR-ROOT-001.

## Build a dev MSI
Prerequisites: Rust toolchain (`rust-toolchain.toml`) and the WiX Toolset CLI on `PATH` (7.0.0 tested). WiX 7 needs
its Open Source Maintenance Fee EULA accepted (error `WIX7015` otherwise); the organisation accepted it on 2026-11-09
(ADR-DSK-003 D4).

```powershell
packaging\windows\build-msi.ps1 -AcceptWixEula   # -> target\msi\hms-desktop-<version>-dev-x64.msi (+ .sha256)
```

## What the MSI does
| Item | Behaviour |
|---|---|
| Scope | per-machine, x64, administrator rights required |
| Binary | `%ProgramFiles%\HMS Desktop\hms-desktop.exe` |
| Shortcut | Start menu "HMS" |
| Config folder | `%ProgramData%\HMS Desktop\` with SDDL `O:SYG:SYD:PAI(A;OICI;FA;;;SY)(A;OICI;FA;;;BA)(A;OICI;FRFX;;;BU)`: SYSTEM and Administrators full, Users read; ProgramData inheritance removed. Kept on uninstall |
| `HMS_ORIGIN` | optional; writes `config.toml` (`[hms]` / `origin="…"`) only if no `config.toml` exists. Never overwritten or removed |
| WebView2 | install blocked unless the Evergreen runtime is registered (machine or user) |
| Upgrades | major upgrade per version; downgrades refused |
| Not installed | services, tasks, autostart, URL protocols, firewall rules, drivers |

`UpgradeCode` `475C6B2D-093F-452A-BAA8-0D6C0C748BC8` and the two component GUIDs in `hms-desktop.wxs` are permanent.

## IT runbook (draft)
Install (silent):
```cmd
msiexec /i hms-desktop-0.1.0-dev-x64.msi /qn HMS_ORIGIN=https://hms.example.internal /l*v install.log
```
- Use an ASCII (punycode) host name in `HMS_ORIGIN`. The installer writes it without validation; the shell validates it
  at start and shows "Konfigurasi HMS tidak valid" if it is wrong.
- To change the origin later, edit `%ProgramData%\HMS Desktop\config.toml` as administrator. Re-running the installer
  does not overwrite an existing file.
- If a file is copied in by hand, check its owner: the shell accepts only SYSTEM, Administrators or TrustedInstaller.
  Fix with `icacls "%ProgramData%\HMS Desktop\config.toml" /setowner *S-1-5-32-544`.
- If `%ProgramData%\HMS Desktop\config.toml` existed before the first install (for example created by a user), the
  installer keeps it, and the shell refuses it if a non-administrator owns it. Delete it, then reinstall or write a
  new one.

Verify:
```cmd
icacls "%ProgramData%\HMS Desktop"
```
Expected: `NT AUTHORITY\SYSTEM:(OI)(CI)(F)`, `BUILTIN\Administrators:(OI)(CI)(F)`, `BUILTIN\Users:(OI)(CI)(RX)`, and
nothing else.

Upgrade: install the newer MSI the same way. Rollback: uninstall, then install the previous MSI; configuration is
kept.

Uninstall: `msiexec /x hms-desktop-<version>-dev-x64.msi /qn`. Leaves `%ProgramData%\HMS Desktop\` and per-user
WebView2 profiles (`%LOCALAPPDATA%\HMS Desktop\WebView2`). Remove those manually when decommissioning a shared
workstation.

## Not yet done
- Code signing (D1), CI pipeline, SBOM and advisory scan (ADR-DSK-003 §4, §8).
- Install/upgrade/uninstall tests on a clean Windows 11 VM (acceptance criteria in ADR-DSK-003).
- Application icon: the executable has no icon resource yet; brand assets belong to `hms_workspace`.
