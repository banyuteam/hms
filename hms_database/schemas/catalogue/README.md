# Schema `catalogue`

- Migration: `0022_catalogue.sql` (ADR-SVC-012)
- Writer: hms_services catalogue module (`hms_catalogue_rw`), for holders of `catalogue.manage`; every change audited
- Readers: any signed-in session, through the catalogue-v1 API only
- Classification: internal (reference material from outside HMS; no patient data)

Reference sources from outside HMS (web links and Excel, PDF, Word or image files) and the titles of the data each one
holds, browsed in the web Catalogue window.

- `sources`: one entry per external source, per organization. `source_type` is `url`, `excel`, `pdf`, `word` or
  `image` and cannot change after creation. A link has an `https://` URL; file types never do. Edits name the
  `version` they read (optimistic concurrency). Creator and last editor are users of the same organization.
- `data_titles`: the titles of the data a source holds (for example the sheets of a workbook), in order (1-200).
  Deleted with their source.
- `files`: the stored file of a file-type source. The bytes are on the shared hms_services file volume, never in the
  database (shared-postgresql-platform: binary files outside relational tables). The row keeps the volume key
  (`catalogue/yyyy/mm/<uuid>`, never the uploaded file name), the media type found from the file's bytes, the size
  (at most 20 MiB) and the SHA-256. A trigger refuses a file whose type does not match its source (Excel = XLSX,
  Word = DOCX, PDF = PDF, image = PNG or JPEG). Deleted with its source; hms_services then removes the file from the
  volume.

The database cannot check what a file contains: hms_services checks the type from the bytes, refuses macro-enabled or
legacy Office files and PDFs with JavaScript or encryption, scans every upload for malware (ClamAV, fail closed) and
the upload form states that catalogue files must not contain patient data.
