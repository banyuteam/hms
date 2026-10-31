"""PostgreSQL 18 side: checkpoints, row hashes, change events and the mirror tables.

Schema DDL is owned by source/hms_database/cdc-polling/migrations/; this module only reads and
writes rows. Each range is applied in one transaction (`apply_range`).
"""

from __future__ import annotations

import datetime as dt
import json
from dataclasses import dataclass
from typing import Any, Sequence

import psycopg
from psycopg import sql
from psycopg.types.json import Jsonb

from .config import TargetSettings
from .diff import RESYNC_HASH, Key, normalize_key
from .mapping import TableMapping

CONTROL_TABLES = ("table_state", "range_checkpoint", "row_state", "change_event", "scan_run")
MIRROR_META_COLUMNS = ("_cdc_row_hash", "_cdc_synced_at", "_cdc_deleted_at")


class FingerprintMismatch(RuntimeError):
    """The mapping changed since the table was bootstrapped; run `resync` deliberately."""


class SchemaError(RuntimeError):
    """The target schema is missing or does not match the mappings."""


@dataclass
class Range:
    range_id: int
    lower: Key | None
    upper: Key | None
    row_count: int | None
    digest: str | None
    unchanged_streak: int

    @property
    def is_tail(self) -> bool:
        return self.upper is None


@dataclass
class ChangeEvent:
    op: str
    pk_key: str
    before_hash: str | None
    after_hash: str | None
    event_id: Any


@dataclass
class NewRange:
    lower: Key
    upper: Key | None
    row_count: int
    digest: str
    keys: list[str]  # pk_keys that move into this range


def _key_or_none(value: Any) -> Key | None:
    return None if value is None else tuple(value)


class Target:
    def __init__(self, settings: TargetSettings) -> None:
        self._settings = settings
        self.conn: psycopg.Connection | None = None

    def connect(self) -> None:
        self.conn = psycopg.connect(self._settings.conninfo(), autocommit=False)
        with self.conn.cursor() as cur:
            cur.execute("SET TIME ZONE 'UTC'")
        self.conn.commit()

    def close(self) -> None:
        if self.conn is not None:
            self.conn.close()
            self.conn = None

    def _c(self) -> psycopg.Connection:
        if self.conn is None:
            raise RuntimeError("target not connected")
        return self.conn

    # -- schema checks ----------------------------------------------------------------------

    def check_schema(self, mappings: Sequence[TableMapping]) -> list[str]:
        """Return a list of problems (empty = OK)."""
        problems: list[str] = []
        conn = self._c()
        with conn.cursor() as cur:
            cur.execute(
                "SELECT table_name FROM information_schema.tables WHERE table_schema = 'cdc'"
            )
            present = {r[0] for r in cur.fetchall()}
            for t in CONTROL_TABLES:
                if t not in present:
                    problems.append(f"missing control table cdc.{t} (apply hms_database/cdc-polling migrations)")
            for m in mappings:
                cur.execute(
                    "SELECT column_name FROM information_schema.columns "
                    "WHERE table_schema = %s AND table_name = %s",
                    (m.target_schema, m.target_name),
                )
                cols = {r[0] for r in cur.fetchall()}
                if not cols:
                    problems.append(f"missing mirror table {m.target_table}")
                    continue
                expected = {c.target for c in m.columns} | set(MIRROR_META_COLUMNS)
                for missing in sorted(expected - cols):
                    problems.append(f"{m.target_table}: missing column {missing}")
        conn.rollback()
        return problems

    # -- table state ------------------------------------------------------------------------

    def try_lock_table(self, table: str) -> bool:
        """Session-level advisory lock so two instances never scan the same table."""
        conn = self._c()
        with conn.cursor() as cur:
            cur.execute("SELECT pg_try_advisory_lock(hashtext(%s))", (f"cdc-polling:{table}",))
            ok = bool(cur.fetchone()[0])
        conn.commit()
        return ok

    def unlock_table(self, table: str) -> None:
        conn = self._c()
        with conn.cursor() as cur:
            cur.execute("SELECT pg_advisory_unlock(hashtext(%s))", (f"cdc-polling:{table}",))
        conn.commit()

    def ensure_table_state(self, mapping: TableMapping) -> bool:
        """Create the table_state row if needed. Returns True when ranges still need planning."""
        conn = self._c()
        fp = mapping.fingerprint()
        with conn.cursor() as cur:
            cur.execute(
                "SELECT mapping_fingerprint FROM cdc.table_state WHERE table_name = %s FOR UPDATE",
                (mapping.table,),
            )
            row = cur.fetchone()
            if row is None:
                cur.execute(
                    "INSERT INTO cdc.table_state (table_name, mapping_fingerprint, key_strategy) "
                    "VALUES (%s, %s, %s)",
                    (mapping.table, fp, mapping.key_strategy),
                )
            elif row[0] != fp:
                conn.rollback()
                raise FingerprintMismatch(
                    f"mapping for '{mapping.table}' changed since it was bootstrapped; "
                    f"run `cdc-polling resync --table {mapping.table}` to re-apply every row"
                )
            cur.execute("SELECT count(*) FROM cdc.range_checkpoint WHERE table_name = %s", (mapping.table,))
            needs_plan = cur.fetchone()[0] == 0
        conn.commit()
        return needs_plan

    def create_ranges(self, table: str, ranges: Sequence[tuple[Key | None, Key | None]]) -> None:
        conn = self._c()
        with conn.cursor() as cur:
            cur.executemany(
                "INSERT INTO cdc.range_checkpoint (table_name, lower_key, upper_key) VALUES (%s, %s, %s)",
                [
                    (
                        table,
                        None if lo is None else Jsonb(normalize_key(lo)),
                        None if hi is None else Jsonb(normalize_key(hi)),
                    )
                    for lo, hi in ranges
                ],
            )
            cur.execute(
                "UPDATE cdc.table_state SET bootstrapped_at = now(), updated_at = now() WHERE table_name = %s",
                (table,),
            )
        conn.commit()

    def begin_pass(self, table: str) -> int:
        conn = self._c()
        with conn.cursor() as cur:
            cur.execute(
                "UPDATE cdc.table_state SET pass_no = pass_no + 1, last_pass_started_at = now(), "
                "updated_at = now() WHERE table_name = %s RETURNING pass_no",
                (table,),
            )
            pass_no = int(cur.fetchone()[0])
            cur.execute(
                "INSERT INTO cdc.scan_run (table_name, pass_no) VALUES (%s, %s) RETURNING run_id",
                (table, pass_no),
            )
            self._run_id = int(cur.fetchone()[0])
        conn.commit()
        return pass_no

    def finish_pass(self, table: str, stats: dict[str, int], error: str | None = None) -> None:
        conn = self._c()
        conn.rollback()  # drop any half-done range transaction before recording metrics
        with conn.cursor() as cur:
            cur.execute(
                "UPDATE cdc.scan_run SET finished_at = now(), ranges_scanned = %s, ranges_changed = %s, "
                "ranges_split = %s, rows_read = %s, inserts = %s, updates = %s, deletes = %s, error = %s "
                "WHERE run_id = %s",
                (
                    stats.get("ranges_scanned", 0),
                    stats.get("ranges_changed", 0),
                    stats.get("ranges_split", 0),
                    stats.get("rows_read", 0),
                    stats.get("inserts", 0),
                    stats.get("updates", 0),
                    stats.get("deletes", 0),
                    error,
                    self._run_id,
                ),
            )
            cur.execute(
                "UPDATE cdc.table_state SET last_pass_finished_at = now(), updated_at = now() "
                "WHERE table_name = %s",
                (table,),
            )
        conn.commit()

    def due_ranges(self, table: str, limit: int, now: dt.datetime | None = None) -> list[Range]:
        conn = self._c()
        with conn.cursor() as cur:
            cur.execute(
                "SELECT range_id, lower_key, upper_key, row_count, digest, unchanged_streak "
                "FROM cdc.range_checkpoint WHERE table_name = %s AND next_due_at <= COALESCE(%s, now()) "
                "ORDER BY next_due_at, range_id LIMIT %s",
                (table, now, limit),
            )
            rows = cur.fetchall()
        conn.commit()
        return [
            Range(r[0], _key_or_none(r[1]), _key_or_none(r[2]), r[3], r[4], r[5]) for r in rows
        ]

    def next_due_at(self) -> dt.datetime | None:
        conn = self._c()
        with conn.cursor() as cur:
            cur.execute("SELECT min(next_due_at) FROM cdc.range_checkpoint")
            value = cur.fetchone()[0]
        conn.commit()
        return value

    # -- per-range work ---------------------------------------------------------------------

    def mark_unchanged(self, rng: Range, interval_s: int, pass_no: int) -> None:
        conn = self._c()
        with conn.cursor() as cur:
            cur.execute(
                "UPDATE cdc.range_checkpoint SET unchanged_streak = unchanged_streak + 1, "
                "last_scanned_at = now(), next_due_at = now() + make_interval(secs => %s), "
                "last_pass_no = %s, updated_at = now() WHERE range_id = %s",
                (interval_s, pass_no, rng.range_id),
            )
        conn.commit()

    def row_state(self, table: str, range_id: int) -> dict[str, str]:
        conn = self._c()
        with conn.cursor() as cur:
            cur.execute(
                "SELECT pk_key, row_hash FROM cdc.row_state WHERE table_name = %s AND range_id = %s",
                (table, range_id),
            )
            rows = cur.fetchall()
        conn.commit()
        return {r[0]: r[1] for r in rows}

    def _upsert_statement(self, mapping: TableMapping) -> sql.Composable:
        if mapping.upsert_sql:
            return sql.SQL(mapping.upsert_sql)  # hand-written, reviewed SQL from the mappings folder
        cols = [c.target for c in mapping.columns]
        keys = [mapping.column(k).target for k in mapping.key_columns]
        non_keys = [c for c in cols if c not in keys]
        target = sql.Identifier(mapping.target_schema, mapping.target_name)
        insert_cols = sql.SQL(", ").join(sql.Identifier(c) for c in [*cols, "_cdc_row_hash"])
        values = sql.SQL(", ").join(sql.Placeholder(c) for c in [*cols, "_cdc_row_hash"])
        updates = [
            sql.SQL("{} = EXCLUDED.{}").format(sql.Identifier(c), sql.Identifier(c))
            for c in [*non_keys, "_cdc_row_hash"]
        ]
        updates += [sql.SQL("_cdc_synced_at = now()"), sql.SQL("_cdc_deleted_at = NULL")]
        return sql.SQL(
            "INSERT INTO {t} ({cols}) VALUES ({vals}) ON CONFLICT ({keys}) DO UPDATE SET {upd}"
        ).format(
            t=target,
            cols=insert_cols,
            vals=values,
            keys=sql.SQL(", ").join(sql.Identifier(k) for k in keys),
            upd=sql.SQL(", ").join(updates),
        )

    def _soft_delete_statement(self, mapping: TableMapping) -> sql.Composable:
        keys = [mapping.column(k).target for k in mapping.key_columns]
        cond = sql.SQL(" AND ").join(
            sql.SQL("{} = {}").format(sql.Identifier(k), sql.Placeholder(k)) for k in keys
        )
        return sql.SQL(
            "UPDATE {t} SET _cdc_deleted_at = now(), _cdc_synced_at = now() WHERE {cond}"
        ).format(t=sql.Identifier(mapping.target_schema, mapping.target_name), cond=cond)

    def apply_range(
        self,
        mapping: TableMapping,
        rng: Range,
        pass_no: int,
        rows: dict[str, tuple[dict[str, Any], str]],
        deletes: Sequence[str],
        events: Sequence[ChangeEvent],
        row_count: int,
        digest: str,
        interval_s: int,
        changed: bool,
        new_upper: Key | None,
        new_ranges: Sequence[NewRange],
    ) -> None:
        """Apply one range atomically: mirror, row_state, change events, checkpoint, split."""
        conn = self._c()
        converters = {c.name: (c.target, c.converter()) for c in mapping.columns}
        try:
            with conn.cursor() as cur:
                cur.execute(
                    "SELECT 1 FROM cdc.range_checkpoint WHERE range_id = %s FOR UPDATE", (rng.range_id,)
                )
                if rows:
                    params = []
                    for values, row_hash in rows.values():
                        p = {tgt: conv(values[src]) for src, (tgt, conv) in converters.items()}
                        p["_cdc_row_hash"] = row_hash
                        params.append(p)
                    cur.executemany(self._upsert_statement(mapping), params)
                    cur.executemany(
                        "INSERT INTO cdc.row_state (table_name, pk_key, range_id, row_hash) "
                        "VALUES (%s, %s, %s, %s) ON CONFLICT (table_name, pk_key) DO UPDATE "
                        "SET range_id = EXCLUDED.range_id, row_hash = EXCLUDED.row_hash, updated_at = now()",
                        [(mapping.table, k, rng.range_id, h) for k, (_, h) in rows.items()],
                    )
                if deletes:
                    key_targets = [converters[k] for k in mapping.key_columns]
                    cur.executemany(
                        self._soft_delete_statement(mapping),
                        [
                            {tgt: conv(v) for (tgt, conv), v in zip(key_targets, json.loads(k))}
                            for k in deletes
                        ],
                    )
                    cur.execute(
                        "DELETE FROM cdc.row_state WHERE table_name = %s AND pk_key = ANY(%s)",
                        (mapping.table, list(deletes)),
                    )
                if events:
                    cur.executemany(
                        "INSERT INTO cdc.change_event (event_id, table_name, op, pk, before_hash, "
                        "after_hash, range_id, pass_no) VALUES (%s, %s, %s, %s, %s, %s, %s, %s) "
                        "ON CONFLICT (event_id) DO NOTHING",
                        [
                            (
                                e.event_id,
                                mapping.table,
                                e.op,
                                Jsonb(json.loads(e.pk_key)),
                                e.before_hash,
                                e.after_hash,
                                rng.range_id,
                                pass_no,
                            )
                            for e in events
                        ],
                    )
                cur.execute(
                    "UPDATE cdc.range_checkpoint SET row_count = %s, digest = %s, upper_key = %s, "
                    "unchanged_streak = CASE WHEN %s THEN 0 ELSE unchanged_streak + 1 END, "
                    "last_scanned_at = now(), "
                    "last_changed_at = CASE WHEN %s THEN now() ELSE last_changed_at END, "
                    "next_due_at = now() + make_interval(secs => %s), last_pass_no = %s, updated_at = now() "
                    "WHERE range_id = %s",
                    (
                        row_count,
                        digest,
                        None if new_upper is None else Jsonb(normalize_key(new_upper)),
                        changed,
                        changed,
                        interval_s,
                        pass_no,
                        rng.range_id,
                    ),
                )
                for nr in new_ranges:
                    cur.execute(
                        "INSERT INTO cdc.range_checkpoint (table_name, lower_key, upper_key, row_count, "
                        "digest, last_scanned_at, next_due_at, last_pass_no) "
                        "VALUES (%s, %s, %s, %s, %s, now(), now() + make_interval(secs => %s), %s) "
                        "RETURNING range_id",
                        (
                            mapping.table,
                            Jsonb(normalize_key(nr.lower)),
                            None if nr.upper is None else Jsonb(normalize_key(nr.upper)),
                            nr.row_count,
                            nr.digest,
                            interval_s,
                            pass_no,
                        ),
                    )
                    new_id = cur.fetchone()[0]
                    cur.execute(
                        "UPDATE cdc.row_state SET range_id = %s WHERE table_name = %s AND pk_key = ANY(%s)",
                        (new_id, mapping.table, nr.keys),
                    )
            conn.commit()
        except Exception:
            conn.rollback()
            raise

    # -- maintenance ------------------------------------------------------------------------

    def resync(self, table: str, fingerprint: str) -> int:
        """Force every row of a table to be re-applied on the next scans (no data is deleted)."""
        conn = self._c()
        with conn.cursor() as cur:
            cur.execute(
                "UPDATE cdc.row_state SET row_hash = %s, updated_at = now() WHERE table_name = %s",
                (RESYNC_HASH, table),
            )
            cur.execute(
                "UPDATE cdc.range_checkpoint SET digest = NULL, row_count = NULL, unchanged_streak = 0, "
                "next_due_at = now(), updated_at = now() WHERE table_name = %s",
                (table,),
            )
            n = cur.rowcount
            cur.execute(
                "UPDATE cdc.table_state SET mapping_fingerprint = %s, updated_at = now() WHERE table_name = %s",
                (fingerprint, table),
            )
        conn.commit()
        return n

    def status(self) -> list[dict[str, Any]]:
        conn = self._c()
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT t.table_name, t.pass_no, t.bootstrapped_at, t.last_pass_finished_at,
                       count(r.range_id) AS ranges,
                       count(r.range_id) FILTER (WHERE r.next_due_at <= now()) AS ranges_due,
                       count(r.range_id) FILTER (WHERE r.digest IS NULL) AS ranges_unscanned,
                       min(r.last_scanned_at) AS oldest_scan,
                       coalesce(sum(r.row_count), 0) AS rows_tracked,
                       (SELECT count(*) FROM cdc.change_event e
                         WHERE e.table_name = t.table_name AND e.published_at IS NULL) AS unpublished_events
                FROM cdc.table_state t
                LEFT JOIN cdc.range_checkpoint r ON r.table_name = t.table_name
                GROUP BY t.table_name, t.pass_no, t.bootstrapped_at, t.last_pass_finished_at
                ORDER BY t.table_name
                """
            )
            names = [d.name for d in cur.description]
            rows = [dict(zip(names, r)) for r in cur.fetchall()]
        conn.commit()
        return rows
