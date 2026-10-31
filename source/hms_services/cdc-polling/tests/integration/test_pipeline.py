"""End-to-end: synthetic Khanza tables on MariaDB 10.6 -> engine -> PostgreSQL 18 mirror + change events.

All names, numbers and dates are synthetic.
"""

from __future__ import annotations

import datetime as dt
import random
from decimal import Decimal

import pytest

from khanza_cdc import sqlgen
from khanza_cdc.diff import digest_of
from khanza_cdc.source import ReadOnlySource, UnsafeSourceError
from khanza_cdc.config import SourceSettings
from khanza_cdc.target import FingerprintMismatch

pytestmark = pytest.mark.integration

TABLES = ["pasien", "reg_periksa", "diagnosa_pasien", "synthetic_int", "synthetic_enum_key"]


# -- synthetic data ------------------------------------------------------------------------------

def rm(i: int) -> str:
    return f"{i:06d}"


def rawat(day: int, i: int) -> str:
    return f"2026/10/{day:02d}/{i:06d}"


def insert_pasien(admin, ids, *, zero_date_for=None):
    rows = []
    for i in ids:
        tgl = "0000-00-00" if i == zero_date_for else f"19{50 + i % 50:02d}-0{1 + i % 9}-1{i % 9}"
        rows.append((
            rm(i), f"PASIEN SINTETIS {i}", f"99{i:014d}", "L" if i % 2 else "P", "KOTA UJI", tgl,
            f"IBU SINTETIS {i}", f"JL. CONTOH NO {i}", "-", "MENIKAH", "ISLAM", "2026-01-01", f"0899{i:08d}",
            "A09", f"88{i:011d}", 1, 1, 1, 1,
            "-", "SD", "AYAH", "KELUARGA UJI", "-", "-", "-", "-", "-", "-", 1, 1, 1, "-", "-", "-",
        ))
    with admin.cursor() as cur:
        cur.executemany(
            "INSERT INTO pasien (no_rkm_medis, nm_pasien, no_ktp, jk, tmp_lahir, tgl_lahir, nm_ibu, alamat, "
            "gol_darah, stts_nikah, agama, tgl_daftar, no_tlp, kd_pj, no_peserta, kd_kel, kd_kec, kd_kab, kd_prop, "
            "umur, pnd, keluarga, namakeluarga, pekerjaanpj, alamatpj, kelurahanpj, kecamatanpj, kabupatenpj, "
            "perusahaan_pasien, suku_bangsa, bahasa_pasien, cacat_fisik, email, nip, propinsipj) "
            "VALUES (" + ", ".join(["%s"] * 35) + ")",
            rows,
        )


def insert_reg(admin, keys):
    with admin.cursor() as cur:
        cur.executemany(
            "INSERT INTO reg_periksa (no_reg, no_rawat, tgl_registrasi, jam_reg, kd_dokter, no_rkm_medis, kd_poli, "
            "p_jawab, almt_pj, hubunganpj, biaya_reg, stts, stts_daftar, status_lanjut, kd_pj, umurdaftar, sttsumur, "
            "status_bayar, status_poli) VALUES (%s, %s, %s, %s, 'D001', %s, 'U0001', 'PJ UJI', 'ALAMAT UJI', 'AYAH', "
            "%s, 'Belum', 'Lama', 'Ralan', 'A09', 30, 'Th', 'Belum Bayar', 'Lama')",
            [(f"{n:03d}", k, k[:10].replace("/", "-"), f"{8 + n % 8:02d}:{n % 60:02d}:00", rm(n % 10), 15000.5 + n)
             for n, k in enumerate(keys)],
        )


def insert_diag(admin, rows):
    with admin.cursor() as cur:
        cur.executemany(
            "INSERT INTO diagnosa_pasien (no_rawat, kd_penyakit, status, prioritas, status_penyakit) "
            "VALUES (%s, %s, %s, %s, 'Baru')",
            rows,
        )


def seed(admin):
    insert_pasien(admin, range(1, 11), zero_date_for=7)
    insert_reg(admin, [rawat(1 + i // 5, i) for i in range(25)])
    insert_diag(admin, [(rawat(1 + i // 5, i), code, st, p)
                        for i in range(10) for p, (code, st) in enumerate([("A09", "Ralan"), ("J06.9", "Ralan"), ("I10", "Ranap"), ("E11.9", "Ralan")], 1)])
    with admin.cursor() as cur:
        cur.executemany("INSERT INTO synthetic_int (id, val) VALUES (%s, %s)", [(i, f"v{i}") for i in range(3, 30)])
        cur.executemany(
            "INSERT INTO synthetic_enum_key (grp, kind, val) VALUES (%s, %s, %s)",
            [(f"g{i}", kind, f"{i}{kind}") for i in range(6) for kind in ("zeta", "alpha")],
        )


# -- comparison helpers --------------------------------------------------------------------------

def _norm(v):
    if isinstance(v, dt.timedelta):
        s = int(v.total_seconds())
        return f"{s // 3600:02d}:{s % 3600 // 60:02d}:{s % 60:02d}"
    if isinstance(v, dt.time):
        return v.strftime("%H:%M:%S")
    if isinstance(v, (float, Decimal)):
        return str(Decimal(repr(v)) if isinstance(v, float) else v)
    if isinstance(v, str) and v.startswith("0000-00-00"):
        return None
    if isinstance(v, (dt.date, dt.datetime)):
        return v.isoformat()
    return v


def source_rows(w, table):
    m = w.mappings[table]
    cols = ", ".join(f"`{c}`" for c in m.column_names)
    with w.admin.cursor() as cur:
        cur.execute(f"SELECT {cols} FROM `{table}`")
        rows = cur.fetchall()
    k = [m.column_names.index(c) for c in m.key_columns]
    return {tuple(_norm(r[i]) for i in k): tuple(_norm(v) for v in r) for r in rows}


def mirror_rows(w, table):
    m = w.mappings[table]
    cols = ", ".join(c.target for c in m.columns)
    rows = w.pg.execute(f"SELECT {cols} FROM {m.target_table} WHERE _cdc_deleted_at IS NULL").fetchall()
    k = [m.column_names.index(c) for c in m.key_columns]
    return {tuple(_norm(r[i]) for i in k): tuple(_norm(v) for v in r) for r in rows}


def assert_in_sync(w):
    for t in TABLES:
        assert mirror_rows(w, t) == source_rows(w, t), t
        # every range checkpoint digest matches the source (independent checkpoints are exact)
        for rid, lo, hi, n, digest in w.pg.execute(
            "SELECT range_id, lower_key, upper_key, row_count, digest FROM cdc.range_checkpoint WHERE table_name = %s",
            (t,),
        ).fetchall():
            assert (n, digest) == w.src.digest(w.mappings[t], None if lo is None else tuple(lo),
                                               None if hi is None else tuple(hi)), (t, rid)


def make_all_due(w):
    w.pg.execute("UPDATE cdc.range_checkpoint SET next_due_at = now() - interval '1 second'")


def run(w):
    return w.engine.run_once([w.mappings[t] for t in TABLES])


def events(w, table=None):
    sql = "SELECT op, count(*) FROM cdc.change_event"
    params = ()
    if table:
        sql += " WHERE table_name = %s"
        params = (table,)
    return dict(w.pg.execute(sql + " GROUP BY op", params).fetchall())


# -- tests ---------------------------------------------------------------------------------------

def test_python_digest_matches_mariadb_digest(world):
    seed(world.admin)
    for t in TABLES:
        m = world.mappings[t]
        pairs = world.src.key_hashes(m, None, None)
        assert world.src.digest(m, None, None) == digest_of(h for _, h in pairs)


def test_keyset_pages_follow_mariadb_order_incl_enum_keys(world):
    seed(world.admin)
    m = world.mappings["synthetic_enum_key"]
    keys = [k for k, _ in world.src.key_hashes(m, None, None)]  # PAGE_SIZE=3 -> several pages
    assert len(keys) == 12 and len(set(keys)) == 12
    assert keys == sorted(keys)  # string order, not enum-index order


def test_snapshot_then_incremental_changes(world):
    w = world
    seed(w.admin)

    first = run(w)
    assert first.inserts == 10 + 25 + 40 + 27 + 12
    assert events(w) == {"r": first.inserts}
    assert w.pg.execute("SELECT count(*) FROM cdc.range_checkpoint WHERE table_name = 'reg_periksa'").fetchone()[0] > 3
    assert_in_sync(w)

    # Nothing changed: every range answers at level 1.
    make_all_due(w)
    quiet = run(w)
    assert quiet.ranges_scanned > 0 and quiet.ranges_changed == 0
    assert quiet.inserts == quiet.updates == quiet.deletes == 0

    # Update, delete and insert (middle of the key space and the tail).
    with w.admin.cursor() as cur:
        cur.execute("UPDATE pasien SET alamat = 'JL. BARU SINTETIS' WHERE no_rkm_medis = %s", (rm(4),))
        cur.execute("UPDATE pasien SET no_tlp = NULL WHERE no_rkm_medis = %s", (rm(5),))  # value -> NULL
        cur.execute("DELETE FROM reg_periksa WHERE no_rawat = %s", (rawat(2, 6),))
        cur.execute("DELETE FROM diagnosa_pasien WHERE no_rawat = %s AND kd_penyakit = 'I10'", (rawat(1, 2),))
        cur.execute("UPDATE synthetic_int SET val = 'changed' WHERE id = 17")
        cur.execute("UPDATE synthetic_enum_key SET val = 'changed' WHERE grp = 'g3' AND kind = 'alpha'")
    insert_reg(w.admin, [rawat(9, 900)])  # tail
    insert_diag(w.admin, [(rawat(1, 3), "Z00.0", "Ranap", 9)])  # middle of a composite range
    make_all_due(w)
    inc = run(w)
    assert (inc.inserts, inc.updates, inc.deletes) == (2, 4, 2)
    assert events(w, "pasien") == {"r": 10, "u": 2}
    assert events(w, "reg_periksa") == {"r": 25, "c": 1, "d": 1}
    assert events(w, "diagnosa_pasien") == {"r": 40, "c": 1, "d": 1}
    deleted = w.pg.execute(
        "SELECT count(*) FROM khanza_mirror.reg_periksa WHERE _cdc_deleted_at IS NOT NULL"
    ).fetchone()[0]
    assert deleted == 1  # soft delete
    assert_in_sync(w)

    # A deleted key that comes back is un-deleted by the upsert.
    insert_reg(w.admin, [rawat(2, 6)])
    make_all_due(w)
    run(w)
    assert w.pg.execute(
        "SELECT _cdc_deleted_at FROM khanza_mirror.reg_periksa WHERE no_rawat = %s", (rawat(2, 6),)
    ).fetchone()[0] is None
    assert_in_sync(w)


def test_growing_range_is_split_and_stays_exact(world):
    w = world
    seed(w.admin)
    run(w)
    before = w.pg.execute("SELECT count(*) FROM cdc.range_checkpoint WHERE table_name = 'reg_periksa'").fetchone()[0]

    # 15 new visits on one day land in one existing range -> it exceeds 2 x RANGE_SIZE and splits.
    insert_reg(w.admin, [rawat(3, 500 + i) for i in range(15)])
    with w.admin.cursor() as cur:
        cur.executemany("INSERT INTO synthetic_int (id, val) VALUES (%s, %s)", [(i, "tail") for i in range(30, 45)])
    make_all_due(w)
    stats = run(w)
    assert stats.ranges_split >= 2
    after = w.pg.execute("SELECT count(*) FROM cdc.range_checkpoint WHERE table_name = 'reg_periksa'").fetchone()[0]
    assert after > before
    # int_range boundaries stay on multiples of the range size
    bounds = [r[0] for r in w.pg.execute(
        "SELECT lower_key->>0 FROM cdc.range_checkpoint WHERE table_name = 'synthetic_int' AND lower_key IS NOT NULL"
    ).fetchall()]
    assert all(int(b) % 4 == 0 for b in bounds)
    assert_in_sync(w)

    make_all_due(w)
    quiet = run(w)
    assert quiet.ranges_changed == 0 and quiet.ranges_split == 0


def test_crash_mid_pass_resumes_without_loss_or_duplicates(world, monkeypatch):
    w = world
    seed(w.admin)
    calls = {"n": 0}
    real = w.tgt.apply_range

    def flaky(*args, **kwargs):
        calls["n"] += 1
        if calls["n"] == 3:
            raise ConnectionError("simulated crash")
        return real(*args, **kwargs)

    monkeypatch.setattr(w.tgt, "apply_range", flaky)
    with pytest.raises(ConnectionError):
        w.engine.run_table_pass(w.mappings["reg_periksa"])
    done = w.pg.execute(
        "SELECT count(*) FROM cdc.range_checkpoint WHERE table_name = 'reg_periksa' AND digest IS NOT NULL"
    ).fetchone()[0]
    assert done == 2  # two ranges committed independently before the crash
    error = w.pg.execute("SELECT error FROM cdc.scan_run ORDER BY run_id DESC LIMIT 1").fetchone()[0]
    assert error == "ConnectionError"

    monkeypatch.setattr(w.tgt, "apply_range", real)
    run(w)
    assert events(w, "reg_periksa") == {"r": 25}  # no duplicates, nothing lost
    assert_in_sync(w)


def test_mapping_change_requires_resync(world, mappings_dir):
    w = world
    seed(w.admin)
    run(w)
    m = w.mappings["synthetic_int"]
    changed = type(m)(**{**m.__dict__, "columns": m.columns[:1]})
    with pytest.raises(FingerprintMismatch):
        w.engine.run_table_pass(changed)
    w.tgt.resync("synthetic_int", m.fingerprint())
    stats = w.engine.run_table_pass(m)
    assert stats.updates == 27  # every row re-applied ...
    assert events(w, "synthetic_int") == {"r": 54}  # ... and reported as snapshot reads, not updates
    assert_in_sync(w)


def test_source_user_must_be_read_only(world, source_cfg):
    world.src.check_grants()  # SELECT-only reader passes
    admin_src = ReadOnlySource(SourceSettings(
        host=source_cfg["host"], port=source_cfg["port"], user=source_cfg["admin_user"],
        password=source_cfg["admin_password"], database="cdc_it_khanza_synthetic",
    ))
    admin_src.connect()
    try:
        with pytest.raises(UnsafeSourceError):
            admin_src.check_grants()
        # Even a privileged user's session is READ ONLY, so the server itself rejects writes.
        import pymysql

        with pytest.raises(pymysql.MySQLError):
            with admin_src._conn.cursor() as cur:
                cur.execute("START TRANSACTION")
                cur.execute("DELETE FROM synthetic_int")
    finally:
        admin_src.close()


def test_verify_mapping_against_source_schema(world):
    for t in TABLES:
        assert world.src.verify_mapping(world.mappings[t]) == [], t
    m = world.mappings["diagnosa_pasien"]
    wrong = type(m)(**{**m.__dict__, "enum_key_columns": frozenset()})
    assert any("enum_columns" in p for p in world.src.verify_mapping(wrong))


def test_generated_sql_explains_as_index_range_scan(world):
    seed(world.admin)
    m = world.mappings["diagnosa_pasien"]
    sql, params = sqlgen.key_hash_page_sql(m, (rawat(1, 2), "A09", "Ralan"), (rawat(1, 4), "A09", "Ralan"), None, 3)
    with world.admin.cursor() as cur:
        cur.execute("EXPLAIN " + sql, params)
        plan = cur.fetchone()
    names = [d[0] for d in cur.description]
    row = dict(zip(names, plan))
    assert row["type"] == "range" and row["key"] in ("PRIMARY", "no_rawat")
