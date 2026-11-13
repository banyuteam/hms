# Legacy query catalog: inpatient admission order and emergency medical assessment

Read-only statements hms_services runs against the legacy HMS for these two tables (ADR-SVC-004 amendment 2026-11-11).
The SQL source of truth is `hms_services/integrations/legacyhms/timeline.go` (`TimelineSections`); its allowlist test
fails if a statement changes shape, reads a table outside the timeline list or selects a column listed as never read
in [`../field-mapping/admission-order-and-emergency-assessment.md`](../field-mapping/admission-order-and-emergency-assessment.md).

Every statement runs in a read-only session with the legacy statement timeout (`LEGACY_DB_TIMEOUT_SECONDS`), inside
the audited visit timeline read (`GET /encounters/{number}/timeline`, permission `encounter.clinical.read`).

| Name | Used by | Statement (shape) | Index | Cap | Output |
|---|---|---|---|---|---|
| `admission_order` | visit timeline (entry `admission_order`, 1.4.0) | `SELECT tanggal, kd_kamar, bangsal.nm_bangsal, kamar.kelas, diagnosa, catatan, nm_dpjp FROM perintah_ranap LEFT JOIN kamar ON kd_kamar LEFT JOIN bangsal ON kd_bangsal WHERE no_rawat = ? LIMIT 1` | `PRIMARY` (`no_rawat`); joins on primary keys | 1 (primary key) | one entry, `at` = 00:00 of `tanggal`, `time_recorded: false` |
| `emergency_assessment` | visit timeline (entry `emergency_assessment`, 1.4.0) | `SELECT tanggal, dokter.nm_dokter, anamnesis, hubungan, keluhan_utama, rps, rpd, rpk, rpo, alergi, keadaan, gcs, kesadaran, td, nadi, rr, suhu, spo, bb, tb, kepala, mata, gigi, leher, thoraks, abdomen, genital, ekstremitas, ket_fisik, ket_lokalis, ekg, rad, lab, diagnosis, tata, cara_keluar, deskripsi, indikasi FROM penilaian_medis_igd LEFT JOIN dokter ON kd_dokter WHERE no_rawat = ? LIMIT 1` | `PRIMARY` (`no_rawat`); join on the primary key | 1 (primary key) | one entry, `at` = `tanggal` |

Never read: `perintah_ranap.kd_dpjp`, `penilaian_medis_igd.kd_dokter` (join key only).

Schema inventory (metadata only, `inventory-legacy-schema -like 'perintah\_ranap' -like 'penilaian\_medis\_igd'`,
2026-11-11): reads `information_schema` only, no table rows.
