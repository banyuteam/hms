"""SQL generation for the source (MariaDB) side, from a TableMapping.

Every statement here is a SELECT. Identifiers come from validated mappings and are back-quoted;
values are always bound parameters (PyMySQL %s style), never formatted into the text.

Key bounds are tuples in key-column order. Comparisons are emitted in the expanded lexicographic
form `a > ? OR (a = ? AND b > ?) ...`, wrapped in a bound on the leading column, so MariaDB uses an
index range scan for composite keys and compares with the column's own collation.
"""

from __future__ import annotations

from typing import Any, Sequence

from .mapping import TableMapping

Key = tuple[Any, ...]

# Field separator and NULL marker inside the row hash expression (ASCII unit / record separator).
# Changing this expression requires bumping mapping.HASH_VERSION.
_SEP = "CHAR(31)"
_NULL = "CHAR(30)"


def qi(name: str) -> str:
    """Quote a MariaDB identifier. Names are validated by mapping.py; this is defence in depth."""
    if "`" in name:
        raise ValueError("invalid identifier")
    return f"`{name}`"


def row_hash_expr(mapping: TableMapping) -> str:
    parts = ", ".join(f"COALESCE(CAST({qi(c)} AS CHAR), {_NULL})" for c in mapping.column_names)
    return f"MD5(CONCAT_WS({_SEP}, {parts}))"


def key_exprs(mapping: TableMapping) -> list[str]:
    """Key column expressions used in every comparison and ORDER BY.

    ENUM key columns sort by their internal index in ORDER BY but compare as strings in WHERE, which
    would break keyset pagination; they are compared and ordered as CAST(... AS CHAR) instead.
    """
    return [
        f"CAST({qi(c)} AS CHAR)" if c in mapping.enum_key_columns else qi(c) for c in mapping.key_columns
    ]


def _lex(cols: Sequence[str], op: str, values: Key) -> tuple[str, list[Any]]:
    """Lexicographic comparison of key expressions against values. op is one of '>', '>=', '<'."""
    if len(cols) != len(values):
        raise ValueError("key arity mismatch")
    strict = op[0]  # '>' or '<'
    terms: list[str] = []
    params: list[Any] = []
    for i, col in enumerate(cols):
        eqs = [f"{c} = %s" for c in cols[:i]]
        last_op = op if i == len(cols) - 1 else strict
        terms.append("(" + " AND ".join([*eqs, f"{col} {last_op} %s"]) + ")")
        params.extend(values[: i + 1])
    lead_op = ">=" if strict == ">" else "<="
    if len(cols) == 1:
        return terms[0], params
    return f"({cols[0]} {lead_op} %s AND ({' OR '.join(terms)}))", [values[0], *params]


def range_predicate(mapping: TableMapping, lower: Key | None, upper: Key | None) -> tuple[str, list[Any]]:
    """WHERE fragment for lower <= key < upper (None = unbounded)."""
    cols = key_exprs(mapping)
    clauses: list[str] = []
    params: list[Any] = []
    if lower is not None:
        sql, p = _lex(cols, ">=", tuple(lower))
        clauses.append(sql)
        params += p
    if upper is not None:
        sql, p = _lex(cols, "<", tuple(upper))
        clauses.append(sql)
        params += p
    return (" AND ".join(clauses) if clauses else "1=1"), params


def _order_by(mapping: TableMapping) -> str:
    return ", ".join(f"{e} ASC" for e in key_exprs(mapping))


def digest_sql(mapping: TableMapping, lower: Key | None, upper: Key | None) -> tuple[str, list[Any]]:
    """Level 1: row count and XOR of the first 64 bits of every row hash in the range."""
    where, params = range_predicate(mapping, lower, upper)
    sql = (
        "SELECT COUNT(*) AS n, "
        f"COALESCE(BIT_XOR(CAST(CONV(LEFT({row_hash_expr(mapping)}, 16), 16, 10) AS UNSIGNED)), 0) AS x "
        f"FROM {qi(mapping.table)} WHERE {where}"
    )
    return sql, params


def key_hash_page_sql(
    mapping: TableMapping, lower: Key | None, upper: Key | None, after: Key | None, limit: int
) -> tuple[str, list[Any]]:
    """Level 2: one keyset page of (key columns..., row hash) inside the range."""
    where, params = range_predicate(mapping, lower, upper)
    if after is not None:
        sql, p = _lex(key_exprs(mapping), ">", tuple(after))
        where = f"{where} AND {sql}"
        params += p
    keys = ", ".join(qi(c) for c in mapping.key_columns)
    sql = (
        f"SELECT {keys}, {row_hash_expr(mapping)} AS _h FROM {qi(mapping.table)} "
        f"WHERE {where} ORDER BY {_order_by(mapping)} LIMIT %s"
    )
    return sql, [*params, int(limit)]


def fetch_rows_sql(mapping: TableMapping, keys: Sequence[Key]) -> tuple[str, list[Any]]:
    """Level 3: full mapped rows (plus row hash) for the given keys."""
    if not keys:
        raise ValueError("no keys")
    cols = mapping.key_columns
    one = "(" + " AND ".join(f"{qi(c)} = %s" for c in cols) + ")"
    where = " OR ".join([one] * len(keys))
    params = [v for key in keys for v in key]
    select = ", ".join(qi(c) for c in mapping.column_names)
    sql = f"SELECT {select}, {row_hash_expr(mapping)} AS _h FROM {qi(mapping.table)} WHERE {where}"
    return sql, params


def next_boundary_sql(mapping: TableMapping, lower: Key | None, size: int) -> tuple[str, list[Any]]:
    """Keyset strategy: the key `size` rows after `lower` (inclusive) in MariaDB's key order."""
    keys = ", ".join(qi(c) for c in mapping.key_columns)
    if lower is None:
        where, params = "1=1", []
    else:
        where, params = _lex(key_exprs(mapping), ">=", tuple(lower))
    sql = (
        f"SELECT {keys} FROM {qi(mapping.table)} WHERE {where} "
        f"ORDER BY {_order_by(mapping)} LIMIT 1 OFFSET %s"
    )
    return sql, [*params, int(size)]


def min_max_sql(mapping: TableMapping) -> str:
    """int_range strategy: bounds of the single integer key."""
    k = qi(mapping.key_columns[0])
    return f"SELECT MIN({k}) AS lo, MAX({k}) AS hi FROM {qi(mapping.table)}"
