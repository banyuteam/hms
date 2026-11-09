# hms_workspace — HMS web workspace (React 18.3 / Tailwind 3.4)

**Status:** `PARTIALLY IMPLEMENTED` — the existing Banyumanik 2 web workspace, connected to the v4 `hms_services`: live sign-in (auth-v1) and the **User & Access** window
(iam-admin-v1). Synthetic data by default. Re-platform record:
[`docs/adr/0001-replatform-react18-tailwind3.md`](docs/adr/0001-replatform-react18-tailwind3.md).

## Run

Prerequisites: Node ≥ 20, npm.

```bash
npm install
npm run dev        # http://127.0.0.1:5174  (demo accounts enabled by .env.development)
npm run build      # tsc -b && vite build → dist/ (demo accounts NOT included unless VITE_DEMO_AUTH=true)
npm test           # Vitest + Testing Library + axe-core (jsdom)
npm run lint       # ESLint (incl. jsx-a11y, no web storage)
npm run preview    # serve dist/ on :4174
```

Port 5174 is strict: if something else holds it, `npm run dev` fails instead of moving to another port (so another app on 5174 is never mistaken for this one).

### Demo accounts (login/logout demo only — not authentication)

| Username       | Password    | Role                           |
| -------------- | ----------- | ------------------------------ |
| `demo.dokter`  | `Demo#2026` | doctor (edit previews visible) |
| `demo.perawat` | `Demo#2026` | employee (view only)           |

Compiled in only with `VITE_DEMO_AUTH=true`. The session lives in memory; a reload signs out. Try searching `Siti`, `00012346`
or `2026/10/26/000123` on Home.

### Live data through hms-services

The app talks only to its own origin; in development Vite forwards `/api` to `hms-services` (`hms_services/cmd/hms-services`).
Staff sign in with their own Khanza user ID and password (ADR-SVC-001); the session is an HttpOnly, SameSite=Strict cookie the
app cannot read, and the server checks the `Origin` of every state-changing request. The browser holds no token.

```powershell
# 1. hms-services (hms_services/.env: PUBLIC_ORIGIN=http://127.0.0.1:5174 — exactly this dev server's origin):
#    go run ./cmd/hms-services -env-file .env serve      -> 127.0.0.1:8080; wait for /readyz = 200
# 2. this app:
$env:VITE_DATA_SOURCE = 'bff'; npm run dev     # optional: $env:HMS_SERVICES_TARGET (default http://127.0.0.1:8080, loopback only)
```

A wrong `PUBLIC_ORIGIN` shows as "The sign-in service is not available" (the server answers `origin_not_allowed`). A page
reload resumes the session (`GET /api/v1/auth/session`); sign-out and the idle lock end it on the server too; any 401 returns
to sign-in. Sessions holding `iam.users.read` see **Administration → User & Access** on Home (`/access`).

### Testing from other machines (LAN, HTTPS only)

With live data, `vite --host` refuses to start unless HTTPS is configured, so staff IDs, passwords, the session cookie and patient
data never cross the network in plain text. Only the dev server faces the LAN; hms-services stays on loopback.

```powershell
# 1. certificate for this machine's LAN address, outside the repository (30 days; key readable by you only):
#    openssl req -x509 -newkey ec -pkeyopt ec_paramgen_curve:P-256 -nodes -days 30 -keyout key.pem -out cert.pem `
#      -subj "/CN=HMS dev LAN" -addext "subjectAltName=IP:192.168.0.106,IP:127.0.0.1,DNS:localhost"
# 2. hms_services .env: PUBLIC_ORIGIN=https://192.168.0.106:5174 (exactly what testers type; 127.0.0.1 then stops
#    working). Restart hms-services.
# 3. this app, bound to the LAN address only:
$env:VITE_DATA_SOURCE = 'bff'
$env:HMS_DEV_TLS_CERT = "$HOME\.hms-dev-tls\cert.pem"; $env:HMS_DEV_TLS_KEY = "$HOME\.hms-dev-tls\key.pem"
npx vite --host 192.168.0.106
```

Testers open `https://192.168.0.106:5174` and accept the self-signed certificate once (compare its SHA-256 fingerprint).
Known limits: every LAN client reaches hms-services as `127.0.0.1`, so the audit trail does not tell machines apart and the
per-address sign-in limit (20/min) is shared; the Vite dev server is not hardened for networks. A real deployment needs the
ingress, TLS and container images that are not built yet (root `deployment/`).

`VITE_DATA_SOURCE` is a build choice, never guessed at runtime, so the app cannot fall back to synthetic data when the server
is down. A live build: `$env:VITE_DATA_SOURCE='bff'; npm run build`; the ingress serves `dist/` and forwards `/api` to
hms-services. A build without it is the synthetic demo. Neither build contains any `Authorization`/`Bearer` code.

## Routes

| Path          | Purpose                                                                                                                                                    |
| ------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/`           | Home (search, four task cards, AI assistant card, records open in this session)                                                                            |
| `/login`      | Sign-in: demo accounts, or the Khanza user ID and password with live data                                                                                  |
| `/{workflow}` | Opens/focuses a workflow window: `profile`, `records`, `encounter`, `diagnostics`, `lab`, `radiology`, `billing`, `prescription`, `access` (User & Access) |

The URL carries the window _kind_ only — never an MRN, `no_rawat` or name. Unknown workflows show a not-found screen.

## Structure

| Path                                            | Contents                                                                                                  |
| ----------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| `src/state/`                                    | `home.tsx` (window manager reducer), `auth.tsx`, `assistant.tsx`, `session.ts` (`useEndSession`)          |
| `src/lib/resource.ts`                           | In-memory data cache + `useResource` / `useInfiniteResource` (replaces TanStack Query)                    |
| `src/locales/`                                  | `{id,en}/{common,emr}.json`, ICU-subset formatter `icu.ts`, `I18nProvider`, date/number formatting        |
| `src/api/`                                      | Repository functions (synthetic + dev live adapters), data hooks `hooks.ts`                               |
| `src/data/`                                     | Synthetic fixtures (never real patients)                                                                  |
| `src/components/`                               | Button, Icon, StatusPill, Card, FieldRow, MaskedValue, QueryState, LanguageSwitch, Logo, Popover/MenuItem |
| `src/features/workspace/`                       | Shell: top bar, dock, window frame, layouts, workflow routes, window registry                             |
| `src/features/emr/`                             | W1 Profile, W2 Records, W3 Encounter, W4 Diagnostics, viewers, EMR components                             |
| `src/features/home/`, `src/features/assistant/` | Home, AI assistant panel + rule-based replies                                                             |
| `src/features/iam/`                             | User & Access window: users, role grants/revocations, suspension, roles (iam-admin-v1)                    |
| `src/auth/`                                     | `authApi.ts` (sign-in/session/sign-out, auth-v1), demo accounts, idle logout                              |
| `src/pages/`                                    | Login (React Hook Form + Zod), WorkspacePage (URL ↔ window sync), NotFound                               |
| `src/styles/`                                   | `tokens.css` (Figma copy + agreed remodel sizes), `index.css` (Tailwind directives, type roles)           |

Design tokens: `.claude/skills/design-tokens`. Tailwind theme keys map 1:1 to `--hms-*` tokens; no default palette.

## Status and known gaps

- **Live EMR windows** (clinical-read-v1, clinical-timeline-v1): patient search, profile, visit list, visit-number search
  and the visit timeline (Records / Encounter / Diagnostics / lab / radiology / prescription viewers; needs
  `encounter.clinical.read`) work. The billing document shows the charges recorded for the visit in the legacy source
  tables, grouped by category with the server's totals, plus the cashier's saved bill number, payments and receivable
  (needs `billing.read` as well; the document itself sits on the timeline).
- **Tariff book** (`/tariffs`, tariff-book-v1, needs `tariff.read`): today's prices from the legacy master tables
  (procedures, surgery packages, drugs, laboratory with items, radiology), searchable and filtered by payer, class,
  clinic or ward. The billing document shows today's tariff next to each charged price and says when they differ.
- **SEP (BPJS)**: from clinical-timeline-v1 1.3.0 `summary.sep` (legacy `bridging_sep`, ADR-SVC-007), shown in the
  identity strip, the Records SEP section and the billing document. The SEP number is shown in full (owner decision
  B-1: it arrives in the audited timeline read). A server older than 1.3.0 shows "not available from source".
- **Live masked values** arrive masked from the server; Reveal fetches one value (needs `patient.identifiers.reveal`,
  audited by hms_services first) and forgets it when hidden.
- Live sessions get the view-only UI until clinical permissions exist (no doctor/employee role in the v4 session).
- **Allergy:** read from the allergy field of the visit's notes. Encounter windows show a recorded allergy in the identity
  strip; the Patient Profile shows the last visit's allergy note, or that none is written there, under **Special notes**
  (owner decision 2026-11-09). There is no patient-level allergy record in the contracts yet.
- **Data that is not valid** (a stored date that is not on the calendar, an amount or quantity that is not a number) is
  shown with a warning, not as "not recorded". Live dates come back `null` when invalid, so they still read as "not
  recorded" until hms_services sends data-quality flags (`docs/contract-requests/10-contract-request-data-quality-flags.md`).
- **Guarantor (Patient Profile)**: the payers recorded on the patient's visits (`GET /patients/{mrn}/payers`,
  clinical-read-v1 1.1.0, needs `encounter.read`), grouped by payer code with the payer's name, the most recent first;
  each payer expands to its visits. The `pasien` guarantor columns (default payer, BPJS no., employer) are not shown.
- Open requests to hms_services: `docs/contract-requests/09-…` (profile completeness) and `10-…` (data-quality flags).
- **Assistant**: rule-based (no language model). Read-back answers come from the tagged records in the browser; claim
  readiness, in the assistant and in the Records window, is evaluated by hms_services (`src/api/claimApi.ts`,
  assistant-v1, ADR-SVC-006; live needs `assistant.rules.evaluate`; demo shows fixed answers from
  `src/data/claimFixtures.ts`). Baseline and findings: `docs/assistant-inventory.md`.

- No separate Patient Management or tabbed Patient Detail window (owner decision 2026-11-05: remodel windows only).
- Playwright e2e specs (Playwright is not in the approved stack); no visual/browser run of this project yet.
- Language choice is not persisted (in-memory policy); default locale is **Indonesian**.
- `@fontsource/inter` dropped; font stack is `Segoe UI, Inter, Arial`.
- Bundle is one 504 kB JS chunk (fixtures included); route-level code splitting not done yet.
- Demo device enrollment (CLAUDE.md §5) is not implemented.
- **Brand colour:** primary is navy `#264F78` (owner decision 2026-11-05): `action/primary`, `action/accent`, `text/link` and
  `status/info-fg` use it; the focus ring stays blue `#0878F9` so keyboard focus is distinct from selection. Updated in
  `src/styles/tokens.css` and the project's design-tokens skill copy — **the Figma variables are not updated yet**.
