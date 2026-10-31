from pathlib import Path

import pytest

from khanza_cdc.config import PROJECT_ROOT
from khanza_cdc.mapping import MappingError, load_mappings, parse_mapping

BASE = {
    "table": "t",
    "key": {"columns": ["id"]},
    "columns": [{"name": "id", "type": "integer"}, {"name": "tgl", "type": "date"}],
    "target": {"table": "khanza_mirror.t"},
}


def doc(**overrides):
    d = {k: (dict(v) if isinstance(v, dict) else list(v) if isinstance(v, list) else v) for k, v in BASE.items()}
    d.update(overrides)
    return d


def test_shipped_mappings_are_valid():
    mappings = load_mappings(PROJECT_ROOT / "mappings")
    assert {"pasien", "reg_periksa", "diagnosa_pasien"} <= set(mappings)
    assert mappings["diagnosa_pasien"].key_columns == ("no_rawat", "kd_penyakit", "status")
    assert mappings["diagnosa_pasien"].enum_key_columns == {"status"}


def test_defaults():
    m = parse_mapping(doc(), Path("t.yaml"))
    assert m.key_strategy == "keyset" and m.range_size == 5000 and m.page_size == 1000
    assert m.enabled


@pytest.mark.parametrize(
    "overrides, message",
    [
        ({"key": {"columns": []}}, "tables without a primary key"),
        ({"key": {"columns": ["missing"]}}, "must also be listed"),
        ({"key": {"columns": ["id"], "strategy": "magic"}}, "key.strategy"),
        ({"table": "t; DROP"}, "plain identifier"),
        ({"target": {"table": "no_schema"}}, "schema.table"),
        ({"scan": {"hot_interval_s": 100, "cold_interval_s": 10}}, "cold_interval_s"),
        ({"columns": [{"name": "id", "type": "integer", "transform": "nope"}]}, "unknown transform"),
        ({"columns": [{"name": "id", "type": "integer"}, {"name": "id", "type": "integer"}]}, "duplicate"),
        ({"columns": [{"name": "id", "type": "integer", "target": "_cdc_x"}]}, "_cdc_"),
        ({"key": {"columns": ["id"], "enum_columns": ["other"]}}, "enum_columns"),
    ],
)
def test_invalid_mappings_are_rejected(overrides, message):
    with pytest.raises(MappingError, match=message):
        parse_mapping(doc(**overrides), Path("t.yaml"))


def test_file_name_must_match_table():
    with pytest.raises(MappingError, match="file name"):
        parse_mapping(doc(), Path("other.yaml"))


def test_fingerprint_ignores_tuning_but_not_columns():
    a = parse_mapping(doc(), Path("t.yaml"))
    b = parse_mapping(doc(range={"size": 10}, scan={"hot_interval_s": 5, "cold_interval_s": 50}), Path("t.yaml"))
    c = parse_mapping(doc(columns=[{"name": "id", "type": "integer"}]), Path("t.yaml"))
    assert a.fingerprint() == b.fingerprint() != c.fingerprint()


def test_date_columns_turn_zero_dates_into_null():
    m = parse_mapping(doc(), Path("t.yaml"))
    conv = m.column("tgl").converter()
    assert conv("0000-00-00") is None
    assert conv("2026-10-30") == "2026-10-30"


def test_upsert_sql_file_must_stay_in_mappings_folder(tmp_path):
    with pytest.raises(MappingError, match="inside the mappings folder"):
        parse_mapping(doc(target={"table": "khanza_mirror.t", "upsert_sql_file": "../x.sql"}), tmp_path / "t.yaml")
