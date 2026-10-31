"""Integration fixtures: a DISPOSABLE MariaDB 10.6 (synthetic Khanza tables) and PostgreSQL 18.

The admin connection writes synthetic rows into the throwaway test database only. The engine itself
connects with a separately created SELECT-only user, exactly as in production.
Set the CDC_IT_* variables (see tests/integration/README.md) or these tests are skipped.
"""

from __future__ import annotations

import os
from pathlib import Path

import psycopg
import pymysql
import pytest
import yaml

from khanza_cdc.config import EngineSettings, PROJECT_ROOT, SourceSettings, TargetSettings
from khanza_cdc.engine import Engine
from khanza_cdc.mapping import load_mappings
from khanza_cdc.source import ReadOnlySource
from khanza_cdc.target import Target

MIGRATIONS = PROJECT_ROOT.parents[1] / "hms_database" / "cdc-polling" / "migrations"
FIXTURE_SCHEMA = PROJECT_ROOT / "tests" / "fixtures" / "khanza_synthetic_schema.sql"
TEST_DB = "cdc_it_khanza_synthetic"
READER = "cdc_it_reader"
READER_PW = "it-reader-only"  # disposable local test container only

pytestmark = pytest.mark.integration


def _env(name: str, default: str | None = None) -> str:
    value = os.environ.get(name, default)
    if not value:
        pytest.skip(f"integration tests need {name}")
    return value


# Test-only tables that exercise key shapes not covered by the three Khanza mappings.
EXTRA_SOURCE_DDL = [
    "CREATE TABLE `synthetic_int` (`id` int NOT NULL, `val` varchar(20) NULL, PRIMARY KEY (`id`)) "
    "ENGINE=InnoDB CHARACTER SET latin1 COLLATE latin1_swedish_ci",
    # ENUM whose index order ('zeta' < 'alpha') differs from its string order
    "CREATE TABLE `synthetic_enum_key` (`grp` varchar(5) NOT NULL, `kind` enum('zeta','alpha') NOT NULL, "
    "`val` varchar(20) NULL, PRIMARY KEY (`grp`, `kind`)) ENGINE=InnoDB CHARACTER SET latin1 COLLATE latin1_swedish_ci",
]
EXTRA_TARGET_DDL = [
    "CREATE TABLE khanza_mirror.synthetic_int (id integer PRIMARY KEY, val varchar(20), "
    "_cdc_row_hash char(32) NOT NULL, _cdc_synced_at timestamptz NOT NULL DEFAULT now(), _cdc_deleted_at timestamptz)",
    "CREATE TABLE khanza_mirror.synthetic_enum_key (grp varchar(5), kind text, val varchar(20), "
    "_cdc_row_hash char(32) NOT NULL, _cdc_synced_at timestamptz NOT NULL DEFAULT now(), _cdc_deleted_at timestamptz, "
    "PRIMARY KEY (grp, kind))",
]
EXTRA_MAPPINGS = {
    "synthetic_int": {
        "table": "synthetic_int",
        "key": {"columns": ["id"], "strategy": "int_range"},
        "columns": [{"name": "id", "type": "integer"}, {"name": "val", "type": "varchar(20)"}],
        "target": {"table": "khanza_mirror.synthetic_int"},
    },
    "synthetic_enum_key": {
        "table": "synthetic_enum_key",
        "key": {"columns": ["grp", "kind"], "enum_columns": ["kind"]},
        "columns": [
            {"name": "grp", "type": "varchar(5)"},
            {"name": "kind", "type": "text"},
            {"name": "val", "type": "varchar(20)"},
        ],
        "target": {"table": "khanza_mirror.synthetic_enum_key"},
    },
}

RANGE_SIZE = 4
PAGE_SIZE = 3


@pytest.fixture(scope="session")
def source_cfg():
    return {
        "host": _env("CDC_IT_SOURCE_HOST"),
        "port": int(_env("CDC_IT_SOURCE_PORT", "3306")),
        "admin_user": _env("CDC_IT_SOURCE_ADMIN_USER"),
        "admin_password": _env("CDC_IT_SOURCE_ADMIN_PASSWORD"),
    }


@pytest.fixture(scope="session")
def target_settings():
    return TargetSettings(
        host=_env("CDC_IT_TARGET_HOST"),
        port=int(_env("CDC_IT_TARGET_PORT", "5432")),
        user=_env("CDC_IT_TARGET_USER"),
        password=_env("CDC_IT_TARGET_PASSWORD"),
        database=_env("CDC_IT_TARGET_DATABASE"),
    )


@pytest.fixture()
def admin(source_cfg):
    """Admin connection to the disposable source container (synthetic data setup only)."""
    conn = pymysql.connect(
        host=source_cfg["host"], port=source_cfg["port"], user=source_cfg["admin_user"],
        password=source_cfg["admin_password"], charset="utf8mb4", autocommit=True,
    )
    with conn.cursor() as cur:
        cur.execute(f"DROP DATABASE IF EXISTS `{TEST_DB}`")
        cur.execute(f"CREATE DATABASE `{TEST_DB}` CHARACTER SET latin1 COLLATE latin1_swedish_ci")
        cur.execute(f"USE `{TEST_DB}`")
        for stmt in FIXTURE_SCHEMA.read_text(encoding="utf-8").split(";"):
            body = "\n".join(l for l in stmt.splitlines() if not l.strip().startswith("--")).strip()
            if body:
                cur.execute(body)
        for stmt in EXTRA_SOURCE_DDL:
            cur.execute(stmt)
        cur.execute(f"DROP USER IF EXISTS '{READER}'@'%'")
        cur.execute(f"CREATE USER '{READER}'@'%' IDENTIFIED BY '{READER_PW}'")
        cur.execute(f"GRANT SELECT ON `{TEST_DB}`.* TO '{READER}'@'%'")
        cur.execute("SET SESSION sql_mode = ''")  # allow Khanza-style zero dates in synthetic rows
    yield conn
    conn.close()


@pytest.fixture()
def pg(target_settings):
    conn = psycopg.connect(target_settings.conninfo(), autocommit=True)
    conn.execute("DROP SCHEMA IF EXISTS cdc CASCADE")
    conn.execute("DROP SCHEMA IF EXISTS khanza_mirror CASCADE")
    for path in sorted(MIGRATIONS.glob("*.sql")):
        conn.execute(path.read_text(encoding="utf-8"))
    for stmt in EXTRA_TARGET_DDL:
        conn.execute(stmt)
    yield conn
    conn.close()


@pytest.fixture()
def mappings_dir(tmp_path):
    """The shipped mappings with tiny ranges/pages so splits and multi-page scans happen."""
    out = tmp_path / "mappings"
    out.mkdir()
    docs = {}
    for path in (PROJECT_ROOT / "mappings").glob("*.yaml"):
        docs[path.stem] = yaml.safe_load(path.read_text(encoding="utf-8"))
    docs.update(EXTRA_MAPPINGS)
    for name, doc in docs.items():
        doc = dict(doc)
        doc["range"] = {"size": RANGE_SIZE, "page_size": PAGE_SIZE}
        (out / f"{name}.yaml").write_text(yaml.safe_dump(doc), encoding="utf-8")
    return out


@pytest.fixture()
def world(source_cfg, target_settings, admin, pg, mappings_dir):
    src = ReadOnlySource(
        SourceSettings(
            host=source_cfg["host"], port=source_cfg["port"], user=READER, password=READER_PW,
            database=TEST_DB, max_statement_time_s=30,
        )
    )
    src.connect()
    tgt = Target(target_settings)
    tgt.connect()
    mappings = load_mappings(mappings_dir)
    engine = Engine(src, tgt, EngineSettings(mappings_dir=mappings_dir, fetch_batch_size=2))

    class World:
        pass

    w = World()
    w.src, w.tgt, w.engine, w.mappings, w.admin, w.pg = src, tgt, engine, mappings, admin, pg
    yield w
    src.close()
    tgt.close()
