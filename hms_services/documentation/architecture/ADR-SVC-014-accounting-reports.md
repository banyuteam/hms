# ADR-SVC-014: Accounting reports (read-through to the accounting application)

- Status: Draft (owner decision 2026-11-17 recorded in Decision 1; Decisions 4–9 await owner confirmation)
- Date: 2026-11-17
- Owners: hms_services
- Affected projects: hms_services (owner), hms_workspace/web (consumer), akutansi-rsb2 (external, read)
- Related: ADR-SVC-005 (tariff book — the closest shape: external financial reference, permission-gated, audited);
  ADR-SVC-012 (catalogue — the other external-source module); `standards/security/legacy-read-only-policy.md`
  (the layered read-only discipline this reuses); `legacy-read-polling-architecture.md`

## Context

Accounting for RSU Banyumanik 2 lives in its own application (`akutansi-rsb2`, Laravel + Filament): chart of
accounts, journals, ledger, subsidiary ledgers, payables and receivables, financial statements and bank
reconciliation. Its books for January–October 2026 were imported from the Finance department's own LAP KEU
workbooks and verified account by account; the remaining distance to Finance's figures is Rp 438.225.675,47 and
resolves entirely into four restatements Finance made outside any journal.

The owner asked for accounting to appear inside the HMS shell. On 2026-11-17 the owner chose the route:
**gradually, towards an API in hms_services** — the accounting application keeps its data and stays where it is.

That rules out two alternatives that had been on the table: rewriting accounting in Go under a `finance` schema in
hms_database (`hms_services/finance_engine` today holds a README and no code, and `finance` is not among the 16
schemas), and having the React workspace call the accounting application directly.

The accounting application already exposes what is needed. Since 2026-11-17 it serves seven read-only JSON
endpoints under `/api/v1/laporan/` — Neraca, Laba Rugi, Neraca Saldo, Neraca Lajur, Arus Kas, Buku Besar and
Aging — behind Sanctum tokens, each guarded by the same `can:View:<Laporan>` permission as its screen and its
PDF/Excel export route. No endpoint writes.

**This is the first outward HTTP call in hms_services.** A search of the repository finds `http.Client` and
`http.NewRequest` only in tests and in `healthcheck`, which calls the process's own `/healthz` on loopback.
Whatever is decided here becomes the pattern the next outward integration copies.

## Decision

1. **The accounting application keeps its data; hms_services reads it (owner, 2026-11-17).** No accounting data is
   copied into `hms` and no `finance` schema is created. The books stay in one place, which also keeps the
   verification trail — and the four restatement findings — intact.

2. **The web workspace never calls the accounting application directly.** React talks to `/api` on its own origin,
   proxied to hms-services (`VITE_DATA_SOURCE=bff`). Go stays the sole authority for authentication and
   authorization, as `hms_services/CLAUDE.md` requires. The workspace's own `.env.example` forbids the alternative
   outright: *"Never put passwords, API keys … in any VITE_ variable."*

3. **Read-only, and enforced in layers rather than trusted.** The accounting application exposes no write endpoint;
   the client in hms_services accepts `GET` only and refuses any other method before a request is built; the token
   it carries belongs to an account that holds only the seven `View:` permissions. Three layers for one rule, the
   same discipline as `integrations/legacyhms` (SELECT-only account, read-only session, `SELECT `-prefix check).

4. **One permission per report**, mirroring the accounting application rather than inventing a second vocabulary:

   | HMS permission | Accounting permission |
   |---|---|
   | `accounting.neraca.read` | `View:Neraca` |
   | `accounting.laba-rugi.read` | `View:LabaRugi` |
   | `accounting.neraca-saldo.read` | `View:NeracaSaldo` |
   | `accounting.neraca-lajur.read` | `View:NeracaLajur` |
   | `accounting.cash-flow.read` | `View:CashFlow` |
   | `accounting.buku-besar.read` | `View:BukuBesar` |
   | `accounting.aging.read` | `View:AgingReport` |

   One `accounting.read` for all seven was considered and not chosen: the accounting application already grants
   them one by one, and two definitions of "who may see the balance sheet" will diverge. Aging is the reason this
   matters most — it carries counterparty names and amounts owed per person, the most sensitive of the seven.

5. **Every read is audited, fail closed.** Accounting is internal financial data. ADR-SVC-005 audits tariff reads
   for the same reason, and `tariffs.record()` withholds the data and answers 503 when the audit write fails.
   This module follows it exactly: nothing is returned that was not recorded. Audit detail holds the report, the
   period and the row count — never figures or counterparty names.

6. **One service token, not per-user credentials.** hms_services calls the accounting application as a single
   caller; the accounting application cannot tell who is reading. That is the consequence of Decision 2 and it is
   acceptable only because hms_services writes the audit itself (Decision 5). The accounting application's own
   audit is not useful for this path and must not be relied on for it.

   The token is configuration, read through `config.parser.secret("ACCOUNTING_API_TOKEN", false)` so that
   `ACCOUNTING_API_TOKEN_FILE` works and the value is a `config.Secret` — redacted by `String`, `GoString` and
   `MarshalText`, revealed only where the code says `Reveal()`. It is optional at the parser and required by
   Decision 11; setting both the variable and its `_FILE` form is refused either way.

7. **Responses are parsed into typed structs, never `map[string]any`.** If the accounting application changes a
   field, Go fails loudly here rather than sending `null` to React. The lesson is already written in that
   codebase: a `?? null` in `neracaLajurPdf()` turned "this key is missing" into a valid value, and the error
   surfaced one step later in another file without naming its cause.

8. **Timeouts; no retries.** `http.Client{Timeout}` plus a per-request context, mirroring
   `LEGACY_DB_TIMEOUT_SECONDS` (5 seconds). Retries are safe on GET but were not chosen: one request would become
   three against a service that recomputes each report from scratch — `getNeracaData(2026, 8)` measured 87 ms over
   21 queries, and the year-to-date figures it depends on cost one pass per month since the books began.

9. **Buku Besar requires an account.** The accounting application answers 422 without `account_id`; hms_services
   refuses before calling. October 2026 is 5.225 rows across 156 accounts in one month. Its PDF route already
   refuses "all accounts" for the same reason, and an API looser than the UI only moves the failure somewhere less
   visible.

10. **When the accounting application is unreachable, HMS answers 503** with a neutral message and logs the real
    error — the `unavailable(w)` pattern from `tariffs`. Upstream error bodies, hosts and credentials never reach
    the browser.
11. **Off by default.** Unless `ACCOUNTING_API_BASE_URL` is set the module is off and hms-services serves its
    other modules unchanged; once set, the token is required and the URL must carry a scheme. A token without a
    base URL is refused rather than ignored. This follows `config.Files`, which is off unless `FILES_DIR` is set
    and then requires its scanner, and refuses `CLAMAV_ADDR` without it. Accounting must not be able to stop
    sign-in from working. Timeout is `ACCOUNTING_API_TIMEOUT_SECONDS`, 1–30, default 5 — the same default as
    `LEGACY_DB_TIMEOUT_SECONDS`.

## Alternatives considered

- **Rewrite accounting in Go under schema `finance`.** The cleanest end state and the one `finance_engine/README.md`
  sketches. Not chosen: it discards a verified ledger, its 855 tests and its two-layer import checks, and the
  problem it solves — one database — is not a problem anyone has today.
- **React calls the accounting application directly.** Fewest moving parts. Not chosen: it needs a credential in
  the browser bundle, which the workspace's own configuration forbids, and it puts a second authorization system
  behind one screen.
- **Copy accounting figures into `hms` on a schedule.** Would survive the accounting application being down. Not
  chosen: two copies of the books is the failure mode this project has spent months removing, and a stale balance
  sheet that looks current is worse than one that is briefly unavailable.

## Consequences

- Positive: accounting appears in the HMS shell without moving the books; the verification trail and the four
  restatement findings stay where they are; the module is small enough to grow one report at a time.
- Negative: HMS now depends on a service it does not own being up. There is no cache, so an accounting outage is an
  accounting outage in HMS too (Decision 10 makes it legible).
- Negative: this is the first outward HTTP integration here; the client, its timeouts and its error handling will be
  copied by whatever integrates next, including by people who will not read this ADR.
- Privacy/security: accounting holds no PHI, but Aging holds counterparty names and amounts owed. Permission-gated
  per report and audited per read.

## Open questions (owner)

- **Which HMS roles hold which of the seven permissions.** This is the same table that has been waiting for the
  Finance department since 13 August (`akutansi-rsb2/docs/pertanyaan-keuangan.md`, item 15), now blocking two
  systems. Until answered, no role holds any of them — the rule this project has used from the start.
- **The accounting application's base URL from the HMS host**, and whether it is reachable from where hms-services
  runs in each environment.
- **Who owns the service account** in the accounting application, and how its token is rotated.

## Rollout

1. **Neraca only.** It proves the chain that does not exist yet in this repository: Go calls an outward HTTP
   service, carries a secret from `core/config`, handles a timeout, writes an audit event and serves the result.
   If something unexpected surfaces, it surfaces while one report is missing rather than seven.
2. The remaining five list-shaped reports, which are repetition once the chain holds.
3. Buku Besar, which is the only one with a required parameter and a size limit.
4. Identity: mapping an HMS session to what the accounting application would call a role. Deliberately last,
   because it waits on the rights matrix.

## Acceptance criteria

- [x] `core/config`: `ACCOUNTING_API_BASE_URL` and `ACCOUNTING_API_TOKEN` (with `_FILE`), validated at startup,
      with tests for the missing and the both-set cases.
      with tests for the missing and the both-set cases.
- [x] GET-only client with timeout, typed decoding, and a test proving a non-GET method is refused before a request
      is built.
- [x] Neraca: permission registered, endpoint behind `RequireSession` + `RequirePermission`.
- [ ] The remaining six reports, each with its own permission, and a test proving one report's permission does not
      open another.
- [x] Audit written per read, fail closed, with a test that withholds the data when the audit write fails.
- [ ] Buku Besar refuses a request without `account_id`.
- [x] Upstream failure answers 503 and leaks nothing: a test asserting the upstream error body does not appear in
      the response.
- [ ] PostgreSQL integration tests, as the other modules have.
- [ ] Web: the Keuangan window reads through `/api`, and hides what the session may not see — the shell already
      does this elsewhere (`emr.payer.forbidden`).
- [ ] Owner: the rights matrix; the base URL per environment; the service account.