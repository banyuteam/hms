# HMS Workspace Deployment

This directory coordinates development, CI/test and production deployment for the platform. Each project owns its own
image: `hms_services/Dockerfile` and `hms_workspace/web/Dockerfile` (with `nginx/default.conf`).

| File | Purpose | Readiness |
|---|---|---|
| `compose.yaml` | Local development stack | Development only; not yet run with Docker |
| `compose.production.yaml` | Production topology template (prebuilt images, file secrets, no database service) | Template |
| `compose.documents.yaml` | Opt-in overlay: document understanding (scanner, converter, AI bridge, document volume) | Development only; not yet run with Docker |
| `compose.production.documents.yaml` | Production template of the same overlay | Template |
| `.env.example` | Non-secret settings for `compose.yaml` | |
| `secrets/` | Git-ignored development secret files ([secrets/README.md](secrets/README.md)) | Development only |
| `ENVIRONMENTS.md`, `RELEASE-CHECKLIST.md` | Environment matrix and release gate | |
| `../.github/workflows/ci.yml` | CI: database, services, web, image build and smoke tests | Written; first run pending |

## Development stack (`compose.yaml`)

```text
postgres ─▶ db-bootstrap ─▶ db-migrate ─▶ org-setup ─▶ hms-services ─▶ hms-web ◀── browser (127.0.0.1:8088)
(superuser   (superuser,     (hms_meta_     (hms_meta_   (hms_meta_      (nginx: SPA + /api proxy)
 only here)   one-shot)       migrator)      runtime)     runtime)  ──▶ legacy Khanza MySQL (external, SELECT-only)
```

- `db-bootstrap`, `db-migrate` and `org-setup` are one-shot jobs that run on every `up` and change nothing when the
  database is already current (bootstrap is re-runnable, the migration ledger skips applied files, setup is idempotent).
- Only two ports are published, both on loopback: the web app (`8088`) and PostgreSQL (`5433`) for psql.
- `hms-services` and `hms-web` run read-only, without Linux capabilities, as non-root users.

### First run

1. Settings: copy `deployment/.env.example` to `deployment/.env` and fill in `LEGACY_DB_NAME` and `LEGACY_DB_USER`
   (the SELECT-only Khanza account). A Khanza on this machine is `LEGACY_DB_HOST=host.docker.internal`.
2. Secrets: create the six files in `deployment/secrets/dev/`. Generate the three PostgreSQL passwords and put the
   Khanza account password and the two Khanza AES keys in the other three (no trailing newline needed):

   ```powershell
   # Windows PowerShell 5.1 or PowerShell 7, from the workspace root
   $d = 'deployment\secrets\dev'; New-Item -ItemType Directory -Force $d | Out-Null
   $rng = [Security.Cryptography.RNGCryptoServiceProvider]::new()
   foreach ($f in 'postgres_superuser_password','hms_migrator_password','hms_runtime_password') {
     $b = [byte[]]::new(24); $rng.GetBytes($b)
     [IO.File]::WriteAllText("$PWD\$d\$f", (($b | ForEach-Object { $_.ToString('x2') }) -join ''))
   }
   foreach ($f in 'legacy_db_password','legacy_login_id_key','legacy_login_password_key') {
     Read-Host -AsSecureString "Value for $f" | ForEach-Object {
       [IO.File]::WriteAllText("$PWD\$d\$f", [Net.NetworkCredential]::new('', $_).Password) }
   }
   ```

   ```bash
   # bash (Linux/macOS)
   d=deployment/secrets/dev; mkdir -p "$d"
   for f in postgres_superuser_password hms_migrator_password hms_runtime_password; do
     openssl rand -hex 24 | tr -d '\n' > "$d/$f"; done
   for f in legacy_db_password legacy_login_id_key legacy_login_password_key; do
     read -rsp "Value for $f: " v; printf '%s' "$v" > "$d/$f"; echo; done
   chmod 644 "$d"/*   # Linux: the non-root service users (uid 65532) must be able to read the mounted files
   ```

3. Validate and start:

   ```bash
   docker compose -f deployment/compose.yaml config -q
   docker compose -f deployment/compose.yaml up --build
   ```

4. Open `http://127.0.0.1:8088` exactly (not `localhost`): it is `hms-services`' `PUBLIC_ORIGIN`, and sign-in rejects
   any other origin.

Notes:
- PostgreSQL takes `postgres_superuser_password` only when the volume is first created. To start over:
  `docker compose -f deployment/compose.yaml down -v` (deletes the development database).
- The first IAM administrator is still created by hand: `docker compose -f deployment/compose.yaml run --rm
  hms-services bootstrap-admin ...` (see `hms_services/README.md`).
- Live data in the dev stack is real Khanza data from the development server: handle it under the approved data
  handling process (root `CLAUDE.md` §13).

## CI (`.github/workflows/ci.yml`)

| Job | What it proves |
|---|---|
| Database + services | `hms_database` bootstrap, migrate (plan, apply, nothing pending after), SQL tests; `gofmt`, `go vet`, `go test` including the PostgreSQL integration tests (a skipped test fails the job) |
| Web | `npm ci`, typecheck, lint, Prettier check, Vitest, production build |
| Images | Both compose files validate; both images build; `hms-services` runs as non-root and rejects missing configuration; `hms-web` serves `/healthz`, SPA routes and security headers as non-root |

CI uses no secrets and pushes nothing. Not covered yet: image vulnerability scan, SBOM, digest-pinned base images,
end-to-end tests against a running stack (needs a synthetic legacy database).

## Document understanding overlay (ADR-SVC-009)

```bash
docker compose -f deployment/compose.yaml -f deployment/compose.documents.yaml up --build
```

Adds four pieces next to the development stack; each sits on its own network with `hms-services` only:

| Service | Does | Network | Outbound |
|---|---|---|---|
| `clamav` | Malware scan of every upload (clamd INSTREAM on 3310); about 1.5-2.5 GB RAM, a few minutes to load signatures | `hms-scan` | ClamAV signature mirrors only |
| `converter` | DOCX/XLSX to PDF (LibreOffice behind Gotenberg on 3000; browser routes and webhooks off) | `hms-convert` (internal) | none |
| `hms-ai-bridge` | The only component that calls the AI provider (`hms_services/runtimes/python-workers/ai-bridge`) | `hms-ai` (internal) + `hms-ai-egress` | Anthropic API (HTTPS) only |
| `hms_assistant_documents` volume | Uploaded files (D-2): written by `hms-services`, mounted **read-only** in the bridge | - | - |

None of them can reach PostgreSQL, the legacy HMS or each other. Docker cannot filter outbound traffic by host name, so
**production must enforce the outbound allow-list above** at the host firewall or an egress proxy, encrypt the document
volume at rest (D-8), back it up with a tested restore, and run one `hms-services` replica while documents are on a local
volume. Two more secret files are needed (`ai_bridge_secret`, `anthropic_api_key`; secrets/README.md). The Anthropic key
must belong to the organization with zero data retention (D-3). Development and CI use synthetic documents only.

Status: the bridge is a skeleton (`/v1/read` answers `not_implemented`), and `hms-services` does not use the scanner,
converter or bridge yet (ADR-SVC-009 steps 3 and 4). Image versions (`clamav/clamav:1.4`, `gotenberg/gotenberg:8`,
`python:3.13.11-slim`) are not verified here; pin them by digest and scan them before any release.

## Legacy MySQL
Legacy MySQL is an external protected system. It is not provisioned or migrated by this Compose project. Configure only
a dedicated SELECT-only credential and allow network access from `hms-services` only.

## Production
`compose.production.yaml` is a template, not a deployment. Production needs a controlled CI/CD process that builds,
scans, signs/attests and publishes immutable images; deploy by digest. Use managed PostgreSQL where possible, run
bootstrap and migrations as a reviewed one-shot release step, put a TLS ingress in front of `hms-web`, and follow
`RELEASE-CHECKLIST.md`. Self-hosted PostgreSQL needs a separate storage, backup, restore and HA review.
