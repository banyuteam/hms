"""Read-only access to the Khanza MariaDB replica.

Three independent guards keep Khanza untouched (root CLAUDE.md rule 1):
1. a statement allowlist: only SELECT / SHOW / SET SESSION / read-only transactions are sent;
2. the session is set READ ONLY, so the server rejects writes even if a grant is wrong;
3. `check_grants()` refuses to start when the user holds any privilege beyond reading.
"""

from __future__ import annotations

import contextlib
import logging
import re
from typing import Any, Iterator, Sequence

import pymysql

from . import sqlgen
from .config import SourceSettings
from .diff import Key, pk_key
from .mapping import TableMapping

log = logging.getLogger(__name__)

_ALLOWED = re.compile(
    r"^\s*(SELECT\b|SHOW\b|SET\s+SESSION\b|START\s+TRANSACTION\s+WITH\s+CONSISTENT\s+SNAPSHOT,\s*READ\s+ONLY\s*$"
    r"|COMMIT\s*$|ROLLBACK\s*$)",
    re.IGNORECASE,
)

# Privileges a read-only CDC user may hold. Anything else (INSERT, UPDATE, ALL PRIVILEGES, ...) is refused.
_READ_PRIVILEGES = {
    "USAGE",
    "SELECT",
    "SHOW VIEW",
    "REPLICATION CLIENT",
    "BINLOG MONITOR",
    "SLAVE MONITOR",
    "REPLICA MONITOR",
    "PROCESS",
}


class UnsafeSourceError(RuntimeError):
    """The source connection could modify Khanza; the service refuses to run."""


def assert_read_only_statement(sql: str) -> None:
    if not _ALLOWED.match(sql):
        raise UnsafeSourceError("statement not allowed on the Khanza source (read-only allowlist)")


def parse_grant_privileges(grant_line: str) -> set[str]:
    """'GRANT SELECT, SHOW VIEW ON `db`.* TO ...' -> {'SELECT', 'SHOW VIEW'}."""
    match = re.match(r"^\s*GRANT\s+(.*?)\s+ON\s+", grant_line, re.IGNORECASE | re.DOTALL)
    if not match:
        # Role grants ("GRANT `role` TO user") or proxy grants: treat as unknown, i.e. unsafe.
        return {"<unparsed grant>"}
    privs = set()
    body = re.sub(r"\(.*?\)", "", match.group(1))  # column-level grants: SELECT (col, col)
    for part in body.split(","):
        privs.add(re.sub(r"\s+", " ", part.strip().upper()))
    return privs


def unsafe_privileges(grant_lines: Sequence[str]) -> set[str]:
    unsafe: set[str] = set()
    for line in grant_lines:
        unsafe |= parse_grant_privileges(line) - _READ_PRIVILEGES
    return unsafe


class ReadOnlySource:
    def __init__(self, settings: SourceSettings) -> None:
        self._settings = settings
        self._conn: pymysql.connections.Connection | None = None
        self.rows_read = 0
        self.max_replica_lag_s = settings.max_replica_lag_s

    # -- connection -------------------------------------------------------------------------

    def connect(self) -> None:
        s = self._settings
        ssl = {"ca": s.ssl_ca} if s.ssl_ca else None
        self._conn = pymysql.connect(
            host=s.host,
            port=s.port,
            user=s.user,
            password=s.password,
            database=s.database,
            charset="utf8mb4",  # fixed: the row-hash expression depends on the connection charset
            autocommit=True,
            connect_timeout=s.connect_timeout_s,
            ssl=ssl,
        )
        self._exec("SET SESSION TRANSACTION READ ONLY")
        self._exec("SET SESSION TRANSACTION ISOLATION LEVEL REPEATABLE READ")
        self._exec("SET SESSION time_zone = '+00:00'")
        if s.max_statement_time_s > 0:
            self._exec(f"SET SESSION max_statement_time = {int(s.max_statement_time_s)}")

    def close(self) -> None:
        if self._conn is not None:
            with contextlib.suppress(Exception):
                self._conn.close()
            self._conn = None

    def _cursor(self):
        if self._conn is None:
            raise RuntimeError("source not connected")
        try:
            self._conn.ping(reconnect=False)
        except pymysql.MySQLError:
            # Reconnect through connect() so the READ ONLY session settings are applied again.
            log.warning("source connection lost, reconnecting")
            self.close()
            self.connect()
        return self._conn.cursor()

    def _exec(self, sql: str, params: Sequence[Any] | None = None) -> list[tuple]:
        assert_read_only_statement(sql)
        with self._cursor() as cur:
            cur.execute(sql, params)
            return list(cur.fetchall()) if cur.description else []

    # -- safety checks ----------------------------------------------------------------------

    def check_grants(self) -> None:
        lines = [row[0] for row in self._exec("SHOW GRANTS FOR CURRENT_USER()")]
        unsafe = unsafe_privileges(lines)
        if unsafe:
            raise UnsafeSourceError(
                "source user has write or admin privileges "
                f"({', '.join(sorted(unsafe))}); use a SELECT-only user on the replica"
            )
        read_only = self._exec("SELECT @@global.read_only")[0][0]
        log.info("source grants verified read-only", extra={"server_read_only": bool(read_only)})

    def verify_mapping(self, mapping: TableMapping) -> list[str]:
        """Compare a mapping with the live source schema. Returns problems (empty = OK)."""
        problems: list[str] = []
        rows = self._exec(
            "SELECT COLUMN_NAME, DATA_TYPE FROM information_schema.COLUMNS "
            "WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = %s",
            (mapping.table,),
        )
        types = {r[0]: str(r[1]).lower() for r in rows}
        if not types:
            return [f"{mapping.table}: table not found or no SELECT privilege"]
        for col in mapping.column_names:
            if col not in types:
                problems.append(f"{mapping.table}: column {col} not found in source")
        pk = [
            r[0]
            for r in self._exec(
                "SELECT COLUMN_NAME FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() "
                "AND TABLE_NAME = %s AND INDEX_NAME = 'PRIMARY' ORDER BY SEQ_IN_INDEX",
                (mapping.table,),
            )
        ]
        if pk != list(mapping.key_columns):
            problems.append(
                f"{mapping.table}: key.columns {list(mapping.key_columns)} differ from the source primary key {pk}"
            )
        enum_keys = {c for c in mapping.key_columns if types.get(c) == "enum"}
        if enum_keys != set(mapping.enum_key_columns):
            problems.append(f"{mapping.table}: key.enum_columns must be {sorted(enum_keys)}")
        if mapping.key_strategy == "int_range" and not types.get(mapping.key_columns[0], "").endswith("int"):
            problems.append(f"{mapping.table}: int_range needs an integer key column")
        return problems

    def replica_lag_s(self) -> int | None:
        """Seconds behind the primary, or None if unknown (no privilege / not a replica)."""
        try:
            with self._cursor() as cur:
                assert_read_only_statement("SHOW REPLICA STATUS")
                cur.execute("SHOW REPLICA STATUS")
                row = cur.fetchone()
                if not row or not cur.description:
                    return None
                names = [d[0] for d in cur.description]
                value = dict(zip(names, row)).get("Seconds_Behind_Master")
                return None if value is None else int(value)
        except pymysql.MySQLError:
            return None

    # -- reads ------------------------------------------------------------------------------

    @contextlib.contextmanager
    def snapshot(self) -> Iterator[None]:
        """Consistent read-only snapshot (REPEATABLE READ) for levels 2 and 3 of one range."""
        self._exec("START TRANSACTION WITH CONSISTENT SNAPSHOT, READ ONLY")
        try:
            yield
        finally:
            self._exec("COMMIT")

    def digest(self, mapping: TableMapping, lower: Key | None, upper: Key | None) -> tuple[int, str]:
        sql, params = sqlgen.digest_sql(mapping, lower, upper)
        n, x = self._exec(sql, params)[0]
        self.rows_read += int(n)
        return int(n), f"{int(x):016x}"

    def key_hashes(
        self, mapping: TableMapping, lower: Key | None, upper: Key | None
    ) -> list[tuple[Key, str]]:
        """All (key, row hash) pairs in the range, in MariaDB key order, via keyset pagination."""
        width = len(mapping.key_columns)
        out: list[tuple[Key, str]] = []
        after: Key | None = None
        while True:
            sql, params = sqlgen.key_hash_page_sql(mapping, lower, upper, after, mapping.page_size)
            rows = self._exec(sql, params)
            for row in rows:
                out.append((tuple(row[:width]), str(row[width])))
            self.rows_read += len(rows)
            if len(rows) < mapping.page_size:
                return out
            after = out[-1][0]

    def fetch_rows(
        self, mapping: TableMapping, keys: Sequence[Key], batch_size: int
    ) -> dict[str, tuple[dict[str, Any], str]]:
        """pk_key -> (mapped row by source column name, row hash)."""
        names = mapping.column_names
        key_idx = [names.index(k) for k in mapping.key_columns]
        out: dict[str, tuple[dict[str, Any], str]] = {}
        for start in range(0, len(keys), batch_size):
            sql, params = sqlgen.fetch_rows_sql(mapping, keys[start : start + batch_size])
            for row in self._exec(sql, params):
                values = dict(zip(names, row[: len(names)]))
                out[pk_key([row[i] for i in key_idx])] = (values, str(row[len(names)]))
        return out

    def next_boundary(self, mapping: TableMapping, lower: Key | None, size: int) -> Key | None:
        sql, params = sqlgen.next_boundary_sql(mapping, lower, size)
        rows = self._exec(sql, params)
        return tuple(rows[0]) if rows else None

    def min_max(self, mapping: TableMapping) -> tuple[Any, Any]:
        lo, hi = self._exec(sqlgen.min_max_sql(mapping))[0]
        return lo, hi
