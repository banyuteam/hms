"""Per-table mapping files: the pluggable layer between the engine and each Khanza table.

One YAML file per table in the mappings directory. The engine contains no table-specific code;
every source and target statement is generated from a TableMapping (see sqlgen.py), or taken from
an optional hand-written target SQL file named in the mapping.
"""

from __future__ import annotations

import hashlib
import json
import re
from dataclasses import dataclass
from decimal import Decimal
from pathlib import Path
from typing import Any, Callable

import yaml

# Bump when the row-hash expression in sqlgen.py changes: every stored hash becomes stale.
HASH_VERSION = 1

_IDENT = re.compile(r"^[A-Za-z_][A-Za-z0-9_]{0,63}$")
_QUALIFIED = re.compile(r"^[A-Za-z_][A-Za-z0-9_]{0,63}\.[A-Za-z_][A-Za-z0-9_]{0,63}$")
_PG_TYPE = re.compile(r"^[a-z][a-z0-9_ ]*(\(\d+(,\s*\d+)?\))?$")

KEY_STRATEGIES = ("keyset", "int_range")


class MappingError(ValueError):
    """A mapping file is invalid. The message names the file and the field."""


def _zero_date_null(value: Any) -> Any:
    # MariaDB allows '0000-00-00'; PyMySQL returns it as a string. PostgreSQL rejects it.
    if isinstance(value, (str, bytes)):
        text = value.decode() if isinstance(value, bytes) else value
        if text.startswith("0000-00-00") or text.strip() == "":
            return None
    return value


def _strip(value: Any) -> Any:
    return value.strip() if isinstance(value, str) else value


def _empty_to_null(value: Any) -> Any:
    return None if isinstance(value, str) and value.strip() == "" else value


def _float_to_decimal(value: Any) -> Any:
    return Decimal(repr(value)) if isinstance(value, float) else value


TRANSFORMS: dict[str, Callable[[Any], Any]] = {
    "zero_date_null": _zero_date_null,
    "strip": _strip,
    "empty_to_null": _empty_to_null,
    "float_to_decimal": _float_to_decimal,
}

# Applied automatically by target column type, before the column's own transform.
_TYPE_DEFAULT_TRANSFORMS = (
    (("date", "time", "timestamp"), "zero_date_null"),
    (("numeric", "decimal"), "float_to_decimal"),
)


@dataclass(frozen=True)
class ColumnMapping:
    name: str  # source column
    target: str  # mirror column
    pg_type: str  # mirror column type (documentation + `check` command)
    phi: bool
    transform: str | None

    def converter(self) -> Callable[[Any], Any]:
        steps: list[Callable[[Any], Any]] = []
        for prefixes, name in _TYPE_DEFAULT_TRANSFORMS:
            if self.pg_type.startswith(prefixes):
                steps.append(TRANSFORMS[name])
        if self.transform:
            steps.append(TRANSFORMS[self.transform])
        if not steps:
            return lambda v: v

        def convert(value: Any) -> Any:
            for step in steps:
                value = step(value)
            return value

        return convert


@dataclass(frozen=True)
class TableMapping:
    table: str
    domain: str
    enabled: bool
    key_columns: tuple[str, ...]
    key_strategy: str
    enum_key_columns: frozenset[str]
    range_size: int
    page_size: int
    hot_interval_s: int
    cold_interval_s: int
    columns: tuple[ColumnMapping, ...]
    target_table: str
    upsert_sql: str | None
    source_file: Path

    @property
    def column_names(self) -> tuple[str, ...]:
        return tuple(c.name for c in self.columns)

    @property
    def target_schema(self) -> str:
        return self.target_table.split(".", 1)[0]

    @property
    def target_name(self) -> str:
        return self.target_table.split(".", 1)[1]

    def column(self, name: str) -> ColumnMapping:
        for col in self.columns:
            if col.name == name:
                return col
        raise KeyError(name)

    def fingerprint(self) -> str:
        """Hash of everything that changes row identity, row hashes or mirror values.

        Range sizes and scan intervals are excluded: they can change without a resync.
        """
        material = {
            "hash_version": HASH_VERSION,
            "table": self.table,
            "key": list(self.key_columns),
            "enum_keys": sorted(self.enum_key_columns),
            "columns": [[c.name, c.target, c.pg_type, c.transform] for c in self.columns],
            "target": self.target_table,
            "upsert_sql": self.upsert_sql,
        }
        blob = json.dumps(material, sort_keys=True, separators=(",", ":")).encode()
        return hashlib.sha256(blob).hexdigest()[:32]


def _get(doc: dict, path: str, default: Any = ..., *, where: str) -> Any:
    node: Any = doc
    for part in path.split("."):
        if not isinstance(node, dict) or part not in node:
            if default is ...:
                raise MappingError(f"{where}: missing '{path}'")
            return default
        node = node[part]
    return node


def _pos_int(value: Any, field_name: str, where: str, minimum: int = 1) -> int:
    if not isinstance(value, int) or isinstance(value, bool) or value < minimum:
        raise MappingError(f"{where}: '{field_name}' must be an integer >= {minimum}")
    return value


def parse_mapping(doc: dict, source_file: Path) -> TableMapping:
    where = source_file.name
    if not isinstance(doc, dict):
        raise MappingError(f"{where}: top level must be a mapping")

    table = _get(doc, "table", where=where)
    if not isinstance(table, str) or not _IDENT.match(table):
        raise MappingError(f"{where}: 'table' must be a plain identifier")
    if source_file.stem != table:
        raise MappingError(f"{where}: file name must be '<table>.yaml' ({table}.yaml)")

    key_columns = _get(doc, "key.columns", where=where)
    if not isinstance(key_columns, list) or not key_columns:
        raise MappingError(
            f"{where}: 'key.columns' must list the primary-key columns; "
            "tables without a primary key are not supported (see BUILD-PLAN.md §5)"
        )
    strategy = _get(doc, "key.strategy", "keyset", where=where)
    if strategy not in KEY_STRATEGIES:
        raise MappingError(f"{where}: 'key.strategy' must be one of {KEY_STRATEGIES}")
    if strategy == "int_range" and len(key_columns) != 1:
        raise MappingError(f"{where}: 'int_range' needs exactly one integer key column")
    enum_keys = _get(doc, "key.enum_columns", [], where=where)
    if not isinstance(enum_keys, list) or any(k not in key_columns for k in enum_keys):
        raise MappingError(f"{where}: 'key.enum_columns' must list key columns whose MariaDB type is ENUM")
    if strategy == "int_range" and enum_keys:
        raise MappingError(f"{where}: 'int_range' key cannot be an ENUM")

    raw_columns = _get(doc, "columns", where=where)
    if not isinstance(raw_columns, list) or not raw_columns:
        raise MappingError(f"{where}: 'columns' must be a non-empty list")
    columns: list[ColumnMapping] = []
    seen: set[str] = set()
    for i, raw in enumerate(raw_columns):
        cw = f"{where}: columns[{i}]"
        if not isinstance(raw, dict):
            raise MappingError(f"{cw} must be a mapping")
        name = raw.get("name")
        if not isinstance(name, str) or not _IDENT.match(name):
            raise MappingError(f"{cw}: 'name' must be a plain identifier")
        if name in seen:
            raise MappingError(f"{cw}: duplicate column '{name}'")
        seen.add(name)
        target = raw.get("target", name)
        if not isinstance(target, str) or not _IDENT.match(target) or target.startswith("_cdc_"):
            raise MappingError(f"{cw}: 'target' must be a plain identifier not starting with _cdc_")
        pg_type = raw.get("type")
        if not isinstance(pg_type, str) or not _PG_TYPE.match(pg_type.strip().lower()):
            raise MappingError(f"{cw}: 'type' must be a PostgreSQL type such as varchar(15) or date")
        transform = raw.get("transform")
        if transform is not None and transform not in TRANSFORMS:
            raise MappingError(f"{cw}: unknown transform '{transform}' (known: {sorted(TRANSFORMS)})")
        phi = raw.get("phi", False)
        if not isinstance(phi, bool):
            raise MappingError(f"{cw}: 'phi' must be true or false")
        columns.append(ColumnMapping(name, target, pg_type.strip().lower(), phi, transform))

    for key in key_columns:
        if key not in seen:
            raise MappingError(f"{where}: key column '{key}' must also be listed in 'columns'")

    target_table = _get(doc, "target.table", where=where)
    if not isinstance(target_table, str) or not _QUALIFIED.match(target_table):
        raise MappingError(f"{where}: 'target.table' must be 'schema.table'")

    upsert_sql = None
    upsert_file = _get(doc, "target.upsert_sql_file", None, where=where)
    if upsert_file is not None:
        path = (source_file.parent / str(upsert_file)).resolve()
        if source_file.parent.resolve() not in path.parents:
            raise MappingError(f"{where}: 'target.upsert_sql_file' must stay inside the mappings folder")
        if not path.is_file():
            raise MappingError(f"{where}: upsert SQL file not found: {upsert_file}")
        upsert_sql = path.read_text(encoding="utf-8")

    hot = _pos_int(_get(doc, "scan.hot_interval_s", 60, where=where), "scan.hot_interval_s", where)
    cold = _pos_int(_get(doc, "scan.cold_interval_s", 3600, where=where), "scan.cold_interval_s", where)
    if cold < hot:
        raise MappingError(f"{where}: 'scan.cold_interval_s' must be >= 'scan.hot_interval_s'")

    page_size = _pos_int(_get(doc, "range.page_size", 1000, where=where), "range.page_size", where)
    range_size = _pos_int(_get(doc, "range.size", 5000, where=where), "range.size", where, minimum=2)

    enabled = _get(doc, "enabled", True, where=where)
    if not isinstance(enabled, bool):
        raise MappingError(f"{where}: 'enabled' must be true or false")

    return TableMapping(
        table=table,
        domain=str(_get(doc, "domain", "unassigned", where=where)),
        enabled=enabled,
        key_columns=tuple(key_columns),
        key_strategy=strategy,
        enum_key_columns=frozenset(enum_keys),
        range_size=range_size,
        page_size=page_size,
        hot_interval_s=hot,
        cold_interval_s=cold,
        columns=tuple(columns),
        target_table=target_table,
        upsert_sql=upsert_sql,
        source_file=source_file,
    )


def load_mappings(directory: Path) -> dict[str, TableMapping]:
    """Load every <table>.yaml in the directory. Raises MappingError on the first invalid file."""
    if not directory.is_dir():
        raise MappingError(f"mappings directory not found: {directory}")
    mappings: dict[str, TableMapping] = {}
    for path in sorted(directory.glob("*.yaml")):
        with path.open(encoding="utf-8") as fh:
            doc = yaml.safe_load(fh)
        mapping = parse_mapping(doc, path)
        mappings[mapping.table] = mapping
    return mappings
