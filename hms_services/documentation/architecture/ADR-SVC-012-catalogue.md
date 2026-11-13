# ADR-SVC-012: Catalogue of external reference sources

- Status: Proposed (owner decisions 2026-11-11 recorded in Decision 1–6)
- Date: 2026-11-11
- Owners: hms_services
- Affected projects: hms_database (schema `catalogue`, migration 0022), hms_services (owner), hms_workspace/web
  (Catalogue window)
- Related: `contracts/api/catalogue-v1.openapi.yaml`; ADR-SVC-013 (document attachments: the shared file volume,
  file checks, malware scanner and upload helper, `platform/filestore`); ADR-SVC-009 (reverted document pipeline,
  whose file checks are reused); `standards/architecture/shared-postgresql-platform.md` (binary files outside
  relational tables)

## Context
Staff look up reference material that lives outside HMS: web pages (guidelines, regulations, BPJS circulars) and files
(tariff workbooks in Excel, PDF and Word documents, images). Nothing in HMS lists them, so each person keeps their own
bookmarks and copies. The owner asked for a Catalogue window that lists these sources with the titles of the data each
one holds, and lets staff open them.

## Decision
1. **Database, not a static file (owner).** Sources, their data titles and the metadata of their stored file are in
   PostgreSQL, schema `catalogue` (migration 0022, group role `hms_catalogue_rw`), per organization.
2. **Files are stored in HMS (owner), on the shared file volume (owner), not in PostgreSQL.** The bytes go to the
   hms_services file volume under the namespace `catalogue/yyyy/mm/<uuid>` (written atomically, owner-only
   permissions); the database keeps the key, the media type found from the bytes, the size and the SHA-256, which is
   checked again before a file is sent. This follows the platform standard (no binaries in relational tables). The
   volume, the checks and the scanner are shared with document attachments (ADR-SVC-013, `platform/filestore`).
3. **Accepted files.** One file per file-type source, at most 20 MiB: Excel = XLSX, Word = DOCX, PDF, image = PNG or
   JPEG, the type found from the bytes and matched to the source (the database refuses a mismatch too). Refused:
   legacy `.doc`/`.xls`, macro-enabled Office files (also when renamed), ActiveX, encrypted PDFs and PDFs with
   JavaScript, launch actions or embedded files. Images are re-encoded (EXIF/GPS removed). The uploaded file name is
   never read or stored; downloads are named after the source title.
4. **Every upload is scanned for malware (owner), fail closed.** ClamAV scans the original bytes before anything is
   stored; when the scanner is unavailable the upload answers 503 and stores nothing. (Owner's first choice was type
   checks only; changed once the scanner became part of the stack for patient documents.)
5. **Reading: any signed-in session (owner); changing: `catalogue.manage` (owner, in the window).** Listing, viewing
   and downloading need a session of the organization and are not audited (no patient data). Creating, editing,
   deleting, uploading and importing need `catalogue.manage`, granted through User & Access, and write an
   administration audit event in the same transaction; refused uploads are audited with their reason code. Audit
   details never hold titles or file contents. Edits and deletes name the version they read (409 when it changed).
6. **JSON import and template (owner).** A manager can create many sources at once from a JSON document
   (`format: hms-catalogue`, `version: 1`, at most 500 sources), all or nothing; file-type sources then get their
   files one by one. The web window offers the template with synthetic examples, one per type.
7. **Links open outside HMS.** A link must be `https://`; the window opens it in a new tab without a referrer and
   without access to HMS (`noopener noreferrer`). HMS does not fetch or check linked pages.
8. **Downloads cannot run in HMS.** Files are sent as attachments with `nosniff`, `Content-Security-Policy:
   default-src 'none'; sandbox` and `Cache-Control: private, no-store`; only PNG/JPEG may be shown inline.

## Alternatives considered
- Reviewed JSON file in the repository, served read-only (like the assistant's general help): simplest, but every
  change needs a release; not chosen by the owner.
- File bytes in PostgreSQL (`bytea`): no new infrastructure, but against the platform standard; not chosen.
- Object storage (MinIO): the standard's preferred store, but a new service, credentials and backups; deferred.
- Admin import command instead of upload in the window: smaller attack surface; not chosen by the owner.

## Consequences
- Positive: one shared list of reference sources, opened from HMS; files are kept with checks, hashes and audit.
- Negative: a new upload surface for managers; the file volume needs its own backup next to the database backup
  (RUNBOOK); a stale file can remain on the volume if removing it after a delete fails (logged; a sweep is follow-up).
- Privacy: catalogue files must not contain patient data. The upload form says so; HMS cannot verify it. If patient
  data is found, delete the source (the file is removed from the volume) and report it per the incident procedure.
- Security: managers can upload; uploads are type-checked, scanned and size-limited; downloads are sandboxed.

## Rollout
1. Migration 0022 and bootstrap (role `hms_catalogue_rw`).
2. Shared file volume and scanner (ADR-SVC-013); hms_services with the catalogue module; `catalogue.manage` granted to
   the people who maintain the catalogue.
3. A manager imports the real list (template in the web window) and uploads the files.

## Acceptance criteria
- [x] Migration 0022 with tests (types, https links, type/file match, fixed key shape, cascade delete, grants).
- [ ] hms_services: permission registration, every endpoint with permission, version conflict, import all-or-nothing,
      upload checks and scanner fail-closed, SHA-256 check on read, audit in the same transaction; PostgreSQL
      integration tests.
- [ ] Web: Catalogue window (browse, search, type filter, open link, download file, show image; manage: create, edit,
      delete, upload, import, template), keyboard and axe checks.
- [ ] Owner: grant `catalogue.manage`; replace the template examples with the real sources.
