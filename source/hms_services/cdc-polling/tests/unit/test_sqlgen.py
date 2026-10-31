from pathlib import Path

import pytest

from khanza_cdc import sqlgen
from khanza_cdc.mapping import parse_mapping


def mapping(key_columns, enum_columns=(), strategy="keyset"):
    cols = [{"name": c, "type": "text"} for c in key_columns] + [{"name": "val", "type": "text"}]
    doc = {
        "table": "t",
        "key": {"columns": list(key_columns), "strategy": strategy, "enum_columns": list(enum_columns)},
        "columns": cols,
        "target": {"table": "khanza_mirror.t"},
    }
    return parse_mapping(doc, Path("t.yaml"))


def test_single_key_range_predicate():
    sql, params = sqlgen.range_predicate(mapping(["a"]), ("x",), ("y",))
    assert sql == "(`a` >= %s) AND (`a` < %s)"
    assert params == ["x", "y"]


def test_unbounded_range_is_whole_table():
    sql, params = sqlgen.range_predicate(mapping(["a"]), None, None)
    assert sql == "1=1" and params == []


def test_composite_lexicographic_lower_bound_and_params():
    sql, params = sqlgen.range_predicate(mapping(["a", "b", "c"]), (1, 2, 3), None)
    assert sql == (
        "(`a` >= %s AND ((`a` > %s) OR (`a` = %s AND `b` > %s) OR (`a` = %s AND `b` = %s AND `c` >= %s)))"
    )
    assert params == [1, 1, 1, 2, 1, 2, 3]


def test_keyset_page_uses_strict_after_and_limit():
    sql, params = sqlgen.key_hash_page_sql(mapping(["a", "b"]), None, None, ("k", 5), 100)
    assert "((`a` > %s) OR (`a` = %s AND `b` > %s))" in sql
    assert sql.endswith("ORDER BY `a` ASC, `b` ASC LIMIT %s")
    assert params == ["k", "k", "k", 5, 100]


def test_enum_key_columns_compare_and_order_as_text():
    m = mapping(["a", "kind"], enum_columns=["kind"])
    sql, _ = sqlgen.key_hash_page_sql(m, None, None, ("x", "y"), 10)
    assert "CAST(`kind` AS CHAR) > %s" in sql
    assert "ORDER BY `a` ASC, CAST(`kind` AS CHAR) ASC" in sql


def test_row_hash_marks_nulls_and_separates_fields():
    expr = sqlgen.row_hash_expr(mapping(["a"]))
    assert expr == (
        "MD5(CONCAT_WS(CHAR(31), COALESCE(CAST(`a` AS CHAR), CHAR(30)), COALESCE(CAST(`val` AS CHAR), CHAR(30))))"
    )


def test_fetch_rows_binds_every_key():
    sql, params = sqlgen.fetch_rows_sql(mapping(["a", "b"]), [(1, "x"), (2, "y")])
    assert sql.count("(`a` = %s AND `b` = %s)") == 2
    assert params == [1, "x", 2, "y"]


def test_every_generated_statement_is_a_select():
    m = mapping(["a", "b"])
    statements = [
        sqlgen.digest_sql(m, (1, 1), (2, 2))[0],
        sqlgen.key_hash_page_sql(m, None, (2, 2), (1, 1), 10)[0],
        sqlgen.fetch_rows_sql(m, [(1, 1)])[0],
        sqlgen.next_boundary_sql(m, (1, 1), 10)[0],
    ]
    assert all(s.startswith("SELECT ") for s in statements)


def test_identifier_with_backtick_rejected():
    with pytest.raises(ValueError):
        sqlgen.qi("a`b")
