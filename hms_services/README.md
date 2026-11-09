# hms_services

Owns Go runtime behavior, APIs, orchestration, read-only legacy polling, event streaming, Python DSL/IR and isolated
extension workers. Start with `CLAUDE.md`; use project skills under `.claude/skills/`. Coordinate schema and event
contract changes with `hms_database`.

**Status: development-ready** sign-in, IAM administration and the first clinical read slice (patients and encounters). Not CI-, staging- or production-ready yet:
the container image (`Dockerfile`) and the workspace CI (`.github/workflows/ci.yml`) exist but have not had a first
successful run; there is no ingress or TLS yet.

## What exists

| Path | Purpose |
|---|---|
| `cmd/hms-services` | Binary: `serve`, `setup-organization`, `check-legacy-key`, `check-clinical-read`, `check-bill-sources`, `inventory-legacy-schema` (metadata-only legacy schema inventory into `hms_database/legacy/schema-inventory/`), `bootstrap-admin` |
| `core/config` | Typed, validated environment configuration; secrets via `NAME` or `NAME_FILE`, redacted in logs |
| `core/httpx` | Request IDs, security headers, access log, JSON errors, trusted-proxy client address, per-key rate limiter |
| `integrations/legacyhms` | Read-only legacy HMS (Khanza): login check (4 fixed SELECTs), patient/encounter reads (10 fixed SELECTs), visit timeline and bill charges (one fixed SELECT per section), bill reconciliation check |
| `clinical` | Patient and encounter read API (clinical-read-v1), visit timeline and bill (clinical-timeline-v1): mapping to HMS terms, masking, audit on every read |
| `platform/iam` | Sign-in, sessions, authorization middleware; PostgreSQL store on schema `iam` |
| `platform/audit` | Writes `audit.audit_events` |
| `platform/tenancy` | Organization/facility resolution and setup |
| `tariffs` | Tariff book API (tariff-book-v1): legacy master price tables, read-only |
| `assistant`, `assistant/rules` | Assistant rule evaluation (assistant-v1, ADR-SVC-006): deterministic rule sets in Go (no language model), `claim-readiness` v3 over the visit timeline; evaluation receipts, feedback, comments, interaction events and retention (ADR-SVC-008) |
| `contracts/api/auth-v1.openapi.yaml`, `iam-admin-v1.openapi.yaml`, `clinical-read-v1.openapi.yaml`, `clinical-timeline-v1.openapi.yaml`, `tariff-book-v1.openapi.yaml`, `assistant-v1.openapi.yaml` | API contracts |
| `documentation/architecture/ADR-SVC-00*.md` | Design and decisions (sign-in, IAM administration, clinical read, visit timeline and bill, tariff book, assistant evaluation, BPJS bridging read) |

Endpoints: `POST /api/v1/auth/sign-in`, `GET /api/v1/auth/session`, `POST /api/v1/auth/sign-out`, the IAM
administration API under `/api/v1/iam/`, patients and encounters under `/api/v1/patients` and `/api/v1/encounters`,
`GET /api/v1/encounters/{number}/timeline` and `/bill`, the tariff book under `/api/v1/tariffs`,
`GET /api/v1/assistant/rule-sets` and `POST /api/v1/assistant/rules/evaluate`, assistant feedback (assistant-v1 1.1.0,
ADR-SVC-008): `POST /api/v1/assistant/feedback`, `GET /api/v1/assistant/feedback/summary`,
`GET /api/v1/assistant/feedback/comments`, `POST /api/v1/assistant/events` (see the contracts), `GET /healthz`,
`GET /readyz`. A retention loop in `serve` purges expired assistant feedback data every 6 hours.

Clinical reads need the permissions `patient.read`, `encounter.read` and, to reveal one sensitive identifier,
`patient.identifiers.reveal`; the visit timeline (notes, results, medication, surgery, diagnoses) needs
`encounter.clinical.read` and the bill (charges recorded in the source tables) `billing.read` (ADR-SVC-004); the tariff book `tariff.read` (ADR-SVC-005); assistant checks `assistant.rules.evaluate` plus the read permission of the
data they use (`encounter.clinical.read` for claim readiness, ADR-SVC-006; no role has it by default); feedback
summaries `assistant.feedback.review` and feedback comments `assistant.feedback.comments.read` (ADR-SVC-008; no role
has them by default). Grant them through roles in User & Access. Every read is written to the audit trail, and
nothing is returned when the audit event cannot be written.

## Run locally

Prerequisites: Go 1.27, the `hms` database migrated to 0005 (`hms_database`), the Khanza dev database reachable with
a SELECT-only account, and the two Khanza AES keys.

```powershell
cd hms_services
copy .env.example .env       # then fill in passwords and keys; .env is git-ignored

# once: create the organization and facility (uses the runtime role from .env)
go run ./cmd/hms-services -env-file .env setup-organization -org-code RSUB2 -org-name "RSU Banyumanik 2" `
    -facility-code RSUB2-MAIN -facility-name "RSU Banyumanik 2" -timezone Asia/Jakarta

# check the Khanza ID key and staff mapping (read-only, prints counts only, never IDs or keys)
go run ./cmd/hms-services -env-file .env check-legacy-key

# check that every clinical read statement (including timeline and bill) runs and maps on your Khanza
# (read-only, counts only, no patient data printed)
go run ./cmd/hms-services -env-file .env check-clinical-read

# compare the bill's source-table charges with the cashier's saved bills, per category (read-only, counts and
# sample-wide sums only; no encounter numbers, names or single-visit amounts printed)
go run ./cmd/hms-services -env-file .env check-bill-sources -inpatient 50 -outpatient 50

go run ./cmd/hms-services -env-file .env serve

# once, after the chosen person has signed in at least once: make them the first IAM administrator
go run ./cmd/hms-services -env-file .env bootstrap-admin -legacy-user-id <their Khanza user ID>
```

Try it (PowerShell; the Origin header must equal `PUBLIC_ORIGIN`):
```powershell
$c = Get-Credential -Message 'Khanza user ID and password'
$s = New-Object Microsoft.PowerShell.Commands.WebRequestSession
Invoke-RestMethod -Method Post http://127.0.0.1:8080/api/v1/auth/sign-in -WebSession $s `
  -Headers @{ Origin = 'http://127.0.0.1:5174' } -ContentType 'application/json' `
  -Body (@{ user_id = $c.UserName; password = $c.GetNetworkCredential().Password } | ConvertTo-Json)
Invoke-RestMethod http://127.0.0.1:8080/api/v1/auth/session -WebSession $s
```

Try every feature (development servers only). The `iam-admin` role holds only `iam.*` permissions, and an
administrator cannot grant roles to themselves. `scripts/grant-feature-tester.ps1` (or `.sh`, which needs curl and
jq) signs in as the administrator through a prompt and uses only the IAM API, so every change is audited. It
creates or updates the role `feature-tester`, which holds every active permission except `iam.*`, and grants it to
another account for 7 days. That account must have signed in once, and has to sign in again after the grant.
The scripts send `PUBLIC_ORIGIN` from `.env` as the Origin header; override it with `-Origin` / `--origin`.
```powershell
powershell -ExecutionPolicy Bypass -File scripts\grant-feature-tester.ps1                    # list users
powershell -ExecutionPolicy Bypass -File scripts\grant-feature-tester.ps1 -Target <Khanza ID>
powershell -ExecutionPolicy Bypass -File scripts\grant-feature-tester.ps1 -Target <Khanza ID> -Revoke
```
```bash
scripts/grant-feature-tester.sh --target <Khanza ID> [--days 7] [--revoke] [--base-url http://127.0.0.1:8080]
```

## Tests

```powershell
go vet ./...
go test ./...                                   # unit and HTTP tests, no database needed

# PostgreSQL integration tests (development/CI database only: they leave synthetic rows and audit events)
$env:HMS_TEST_DATABASE_URL = 'postgres://hms_meta_runtime:<pw>@127.0.0.1:5432/hms?sslmode=disable'
$env:HMS_TEST_ADMIN_DATABASE_URL = 'postgres://<superuser>:<pw>@127.0.0.1:5432/hms?sslmode=disable'
go test -count=1 -run TestPG ./platform/iam/ ./clinical/ ./assistant/
```

All eight `TestPG*` tests passed on 2026-11-09 against a fresh PostgreSQL 18.6 database built by `hms_database`
bootstrap + migrations `0001`–`0006`. CI runs them on every push and fails if any are skipped.

## Container image

```powershell
docker build -t local/hms-services:dev .      # from hms_services/
```

Multi-stage build to a static binary on distroless `nonroot`; no configuration or secrets in the image (environment
and `*_FILE` mounts at run time). `hms-services healthcheck` probes the process's own `/healthz` for container health
checks (the image has no shell or HTTP client); `/readyz` stays the readiness probe. The workspace development stack
(`deployment/compose.yaml`) runs it as `hms_meta_runtime` after one-shot bootstrap, migration and `setup-organization`
jobs.

## Open items
- Khanza sign-in verified on the dev server (2026-11-08): ID key, password key and `nik` mapping confirmed.
- Clinical role catalog (which roles get patient.read / encounter.read / encounter.clinical.read / billing.read /
  patient.identifiers.reveal): owner decision.
- Run `check-clinical-read` on the dev Khanza (now also the timeline and bill statements); review the facility-wide read
  rule with clinical governance (ADR-SVC-003/004).
- SEP (`bridging_sep`) is read with every visit timeline and returned as `summary.sep` (clinical-timeline-v1 1.3.0,
  number in full) and checked by claim readiness v3 (ADR-SVC-007). INA-CBG / E-Klaim tables (`inacbg_*`) are
  inventoried but not read (B-2, B-3 wait for the casemix team).
- Not yet served: the outpatient discharge summary, other clinical documents.
- First green CI run; image scan, SBOM and digest-pinned base images for releases.
- Ingress rate limiting/TLS, purge of expired sessions and lockout rows, mobile token design.
