# ADR-ROOT-001: `hms_desktop` as the fourth workspace project, in the workspace repository

- Status: Accepted (owner decision 2026-11-09)
- Date: 2026-11-09
- Owners: Root workspace
- Affected projects: hms_desktop (new project); hms_workspace (hosted UI, design tokens, future bridge consumer);
  hms_services (unchanged; remains the authorization authority); hms_database (unchanged)
- Related contracts: `hms_desktop/contracts/bridge/desktop-bridge-v1.md`; ADR-DSK-001, ADR-DSK-002, ADR-DSK-003;
  ADR-SVC-001 (sign-in and sessions)

## Context
`hms_desktop` was started on 2026-11-09 as a Rust (tao + wry) workstation shell that hosts the existing HMS web
workspace in the system WebView and adds native capabilities through a typed bridge (ADR-DSK-001, ADR-DSK-002).
It was created as a separate Git repository nested inside the workspace folder. Two problems followed:

- The workspace repository recorded it as a gitlink (mode 160000) without a `.gitmodules` entry, and the nested
  repository had no remote. Commit `ef33b86` was pushed to `origin` in that state, so clones received an empty
  `hms_desktop/` folder and no one else could see the desktop code.
- The root `CLAUDE.md`, `README.md`, `PROJECT-STRUCTURE.md`, `SKILLS-CATALOG.md` and ownership matrices described
  three projects. Root `CLAUDE.md` §11 requires an ADR for changes to project ownership boundaries.

## Decision
1. `hms_desktop` is a fourth independently owned project. It owns the native desktop runtime: window and WebView
   hosting, the WebView navigation policy, the native bridge and its contract, OS integration, local device access,
   background-agent lifecycle, workstation configuration and desktop packaging.
2. It does not own HMS screens, the design system, business rules, authentication or authorization decisions, or
   any database access. It hosts the web app owned by `hms_workspace` and reuses its canonical design tokens.
   It never connects to PostgreSQL or the legacy MySQL database.
3. `hms_desktop` lives in the workspace repository as an ordinary folder, like the other three projects. Its prior
   history (`732c85b`) is kept as the second parent of the merge commit that folded it in.
4. The desktop bridge contract is authored by `hms_desktop` at `hms_desktop/contracts/bridge/` and versioned there.
   `hms_workspace` is its consumer. The bridge grants native capabilities only; `hms_services` authorizes every
   request regardless of what the bridge allows.
5. The desktop app is a native deliverable, not a container. Root `CLAUDE.md` §13 container rules do not apply to it;
   its signing, distribution and updates follow ADR-DSK-003.

## Alternatives considered
1. **Separate repository with a Git submodule.** Gives a separate access boundary and CI. Rejected for now: every
   clone needs `--recurse-submodules`, cross-project changes (design tokens, bridge consumer, sign-in) span two
   repositories, and no other project is split out. Can be revisited by a later ADR if signing (ADR-DSK-003 D1/D3)
   needs a separately controlled repository.
2. **Keep the nested repository unlinked.** Rejected: the code is invisible to anyone cloning the workspace and
   has no backup.
3. **Place the desktop under `hms_workspace` (for example `hms_workspace/desktop`).** Rejected: the desktop owns a
   Rust runtime, OS integration, device access and installer packaging, which are outside `hms_workspace`'s
   presentation ownership, and a second toolchain in that project would blur its boundary.

## Consequences
- Positive: one clone contains the whole platform; cross-project changes can land in one reviewed commit.
- Negative: desktop history before the fold uses root-relative paths, so `git log -- hms_desktop/...` does not show
  commit `732c85b`; view it with `git log 732c85b`.
- Operational: CI for `hms_desktop` (ADR-DSK-003 §8) runs from the workspace repository and needs a Windows runner.
- Compatibility: no runtime or contract change. Clones of `ef33b86` keep an empty `hms_desktop/` gitlink until they
  pull the fold commit.
- Security/privacy: anyone with workspace repository access can read desktop code; there is no separate access
  boundary. Code-signing keys and certificates must never be committed (root `CLAUDE.md` §13, ADR-DSK-003); signing
  happens only in the release pipeline.
- Patient-safety: none directly. The desktop must not make clinical records available offline by default.

## Ownership impact
`hms_desktop` implements the desktop runtime and bridge. `hms_workspace` owns the hosted UI, design tokens and the
future bridge adapter. `hms_services` remains the authentication and authorization authority. The root workspace
owns this boundary and the shared documentation.

## Migration and rollout
- Done 2026-11-09: gitlink removed; nested history merged; nested `.git` directory removed from the working tree.
- Root `CLAUDE.md`, `README.md`, `PROJECT-STRUCTURE.md`, `SKILLS-CATALOG.md`, both ownership matrices and
  ADR-DSK-003 updated to describe four projects.
- Rollback: revert the documentation commit; reverting the fold commit restores the broken gitlink and is not
  recommended.

## Acceptance criteria
- [x] `git ls-files -s hms_desktop` lists ordinary files and no mode-160000 entry.
- [x] `git log 732c85b` shows the desktop shell history from the workspace repository.
- [x] Root instructions and ownership matrices list `hms_desktop` with its owned and not-owned responsibilities.
- [ ] A fresh clone from `origin` contains the `hms_desktop` sources (after the fold is pushed).
- [ ] ADR-DSK-003 D3: a Windows CI runner builds `hms_desktop` from this repository.
