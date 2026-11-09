# ADR-DSK-002: Hybrid UI loading — packaged startup page, then the hosted HMS origin

- Status: Proposed (owner decision 2026-11-09 recorded below)
- Date: 2026-11-09
- Owners: hms_desktop
- Affected projects: hms_desktop (owner); hms_workspace (hosted UI, unchanged); hms_services (unchanged)
- Related contracts: ADR-SVC-001 (sign-in and sessions); `hms_services/contracts/api/auth-v1.openapi.yaml`;
  `contracts/bridge/desktop-bridge-v1.md`

## Context
The HMS web app talks only to its own origin (`/api/v1/*`). ADR-SVC-001 makes the session a `__Host-`, HttpOnly,
Secure, SameSite=Strict cookie and rejects state-changing requests whose Origin is not the public HMS origin; no CORS
is granted. A web build packaged inside the desktop app would run on a local origin and could neither send that cookie
nor pass the Origin check without a new token design in `hms_services`.

The desktop still needs a screen it controls for states the web app cannot show: no configuration, server
unreachable, and later incompatible versions or updates.

## Decision
1. At start the WebView shows a **packaged startup page** served by the shell through a custom protocol
   (`hmsdesktop`; on Windows `https://hmsdesktop.localhost/`). It contains no PHI, loads nothing from the network and
   has a strict Content Security Policy (`default-src 'self'`). Its visual tokens are generated at build time from
   the canonical `hms_workspace` design tokens; no values are copied by hand.
2. The shell probes `GET <origin>/healthz` (fixed path, HTTPS, OS certificate store, short timeout). On success it
   navigates the WebView to the **hosted HMS origin**; on failure the startup page shows "server unreachable" with a
   retry action.
3. The hosted origin is **one exact origin** (scheme, host, port) from machine-wide configuration
   (`%ProgramData%\HMS Desktop\config.toml` on Windows), writable only by administrators. Release builds require
   `https`; plain `http` is accepted only for loopback hosts in debug builds (Vite dev server).
4. Top-level navigation is allowed only to the hosted origin and the startup page. New windows, downloads and every
   other origin are denied. The web app's sign-in and session handling are used unchanged; the shell never sees
   credentials or session cookies.
5. Bridge commands are allowlisted per origin: the startup page may call only startup commands; the hosted origin
   may call only commands listed for it in the bridge contract.

## Alternatives considered
1. **Hosted origin only**: simplest, but a server outage shows the WebView's own error page and the shell has no
   place for configuration, update or version messages.
2. **Packaged web build**: offline-capable UI, but needs desktop tokens and CORS in `hms_services` (a change to
   ADR-SVC-001), a desktop release for every UI change, and a second build of `hms_workspace` to keep compatible.
3. **Local reverse proxy in the shell** (serve the packaged UI and forward `/api` to the server under one local
   origin): keeps cookies working but makes the shell a network intermediary handling session cookies and PHI, and
   still needs an `hms_services` Origin change.

## Consequences
- Positive: zero change to `hms_services` or `hms_workspace`; the security model of ADR-SVC-001 holds as-is; UI
  updates ship with web deploys.
- Negative: no offline clinical UI (consistent with the rule that clinical records are not offline by default); the
  desktop depends on the server for everything beyond the startup page.
- Operational: each workstation needs the config file; the probe uses the OS trust store so an internal CA trusted by
  Windows works for both the probe and WebView2.
- Compatibility: the hosted UI may be newer than the shell. The bridge contract carries a protocol version; the web
  adapter must treat an unknown or older protocol as "no native capability", never as an error that blocks work.
- Security/privacy: the hosted origin can reach the bridge, so an XSS in the web app reaches it too. Commands exposed
  to the hosted origin must therefore stay narrow, typed and individually threat-modelled, and must not bypass backend
  authorization. URLs are logged by origin only (paths can carry patient or visit identifiers).
- Patient-safety: a server outage is shown as an explicit state, never as stale data.

## Ownership impact
`hms_desktop` owns the startup page, probe, navigation policy and bridge. `hms_workspace` owns the hosted UI and any
future bridge adapter. `hms_services` is unchanged; `/healthz` is the existing ingress health endpoint.

## Migration and rollout
New component; no migration. Development uses the Vite dev server origin (`http://localhost:5173`) in debug builds.
Before staging: TLS ingress for the HMS origin (ADR-SVC-001 open item) and the packaging ADR.

## Acceptance criteria
- [ ] Missing or invalid configuration shows the configuration state, never a blank window.
- [ ] Unreachable server shows the unreachable state; retry re-probes and continues when the server is back.
- [ ] Navigation to another origin, `http` origins in release builds, new windows and downloads are denied (tested).
- [ ] Sign-in, session expiry and sign-out work in the shell exactly as in a browser (manual check against dev).

**Amendment 2026-11-09:** §3 ("writable only by administrators") is not true by default: standard users can create
folders under `C:\ProgramData`. ADR-DSK-003 §1 and §3 make the installer lock the folder down and the shell verify it.
