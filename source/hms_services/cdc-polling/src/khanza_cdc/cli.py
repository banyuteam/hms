"""Command line: `cdc-polling <command>` (or `python -m khanza_cdc <command>`). Same on Windows and Ubuntu."""

from __future__ import annotations

import argparse
import json
import logging
import signal
import sys
import threading
from pathlib import Path

import psycopg
import pymysql

from . import sqlgen
from .config import ConfigError, load_env, load_settings, mappings_dir_from_env
from .engine import Engine
from .logs import setup_logging
from .mapping import MappingError, TableMapping, load_mappings
from .source import ReadOnlySource, UnsafeSourceError
from .target import FingerprintMismatch, Target

log = logging.getLogger("khanza_cdc")


def _select(mappings: dict[str, TableMapping], tables: list[str] | None) -> list[TableMapping]:
    if not tables:
        return list(mappings.values())
    unknown = [t for t in tables if t not in mappings]
    if unknown:
        raise MappingError(f"no mapping for table(s): {', '.join(unknown)}")
    return [mappings[t] for t in tables]


def cmd_validate(args, settings) -> int:
    mappings = load_mappings(settings.engine.mappings_dir)
    for m in mappings.values():
        print(json.dumps({
            "table": m.table, "enabled": m.enabled, "key": list(m.key_columns),
            "strategy": m.key_strategy, "range_size": m.range_size, "columns": len(m.columns),
            "phi_columns": [c.name for c in m.columns if c.phi], "fingerprint": m.fingerprint(),
        }))
    return 0


def cmd_show_sql(args, settings) -> int:
    mappings = load_mappings(settings.engine.mappings_dir)
    for m in _select(mappings, args.table):
        lower = tuple(f"<lower.{c}>" for c in m.key_columns)
        upper = tuple(f"<upper.{c}>" for c in m.key_columns)
        print(f"-- {m.table}: level 1 (digest)\n{sqlgen.digest_sql(m, lower, upper)[0]};\n")
        print(f"-- {m.table}: level 2 (keyset page)\n{sqlgen.key_hash_page_sql(m, lower, upper, lower, m.page_size)[0]};\n")
        print(f"-- {m.table}: level 3 (fetch, 1 key)\n{sqlgen.fetch_rows_sql(m, [lower])[0]};\n")
    return 0


def cmd_check(args, settings) -> int:
    mappings = load_mappings(settings.engine.mappings_dir)
    ok = True
    if not args.skip_source:
        src = ReadOnlySource(settings.source)
        try:
            src.connect()
            src.check_grants()
            lag = src.replica_lag_s()
            src_problems = [p for m in mappings.values() for p in src.verify_mapping(m)]
            print(json.dumps({"source": "ok" if not src_problems else "problems",
                              "problems": src_problems, "replica_lag_s": lag}))
            ok = not src_problems
        finally:
            src.close()
    if not args.skip_target:
        tgt = Target(settings.target)
        try:
            tgt.connect()
            problems = tgt.check_schema(list(mappings.values()))
        finally:
            tgt.close()
        print(json.dumps({"target": "ok" if not problems else "problems", "problems": problems}))
        ok = ok and not problems
    return 0 if ok else 1


def cmd_status(args, settings) -> int:
    tgt = Target(settings.target)
    try:
        tgt.connect()
        for row in tgt.status():
            print(json.dumps(row, default=str))
    finally:
        tgt.close()
    return 0


def cmd_resync(args, settings) -> int:
    mappings = load_mappings(settings.engine.mappings_dir)
    (m,) = _select(mappings, [args.table])
    if not args.yes:
        print(f"This re-reads every row of '{m.table}' from the replica on the next passes. Re-run with --yes.")
        return 2
    tgt = Target(settings.target)
    try:
        tgt.connect()
        n = tgt.resync(m.table, m.fingerprint())
    finally:
        tgt.close()
    print(json.dumps({"table": m.table, "ranges_reset": n}))
    return 0


def cmd_run(args, settings) -> int:
    mappings = _select(load_mappings(settings.engine.mappings_dir), args.table)
    stop = threading.Event()

    def _stop(signum, frame):  # SIGINT on Windows and Ubuntu, SIGTERM from systemd
        log.info("stop requested, finishing the current range")
        stop.set()

    signal.signal(signal.SIGINT, _stop)
    if hasattr(signal, "SIGTERM"):
        signal.signal(signal.SIGTERM, _stop)

    src, tgt = ReadOnlySource(settings.source), Target(settings.target)
    try:
        src.connect()
        src.check_grants()
        tgt.connect()
        problems = [p for m in mappings for p in src.verify_mapping(m)] + tgt.check_schema(mappings)
        if problems:
            for p in problems:
                log.error("schema problem", extra={"problem": p})
            return 1
        engine = Engine(src, tgt, settings.engine, stop)
        if args.once:
            stats = engine.run_once(mappings)
            print(json.dumps({**stats.as_dict(), "tables": stats.tables}))
        else:
            engine.run_forever(mappings)
    finally:
        src.close()
        tgt.close()
    return 0


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(prog="cdc-polling", description="Khanza MariaDB -> PostgreSQL 18 CDC by hash-based range polling")
    p.add_argument("--env-file", type=Path, help="path to a .env file (default: ./.env, then the project's .env)")
    sub = p.add_subparsers(dest="command", required=True)

    sub.add_parser("validate", help="validate mapping files (no database access)").set_defaults(func=cmd_validate, needs_db=False)

    s = sub.add_parser("show-sql", help="print the generated source SQL for review (no database access)")
    s.add_argument("--table", action="append")
    s.set_defaults(func=cmd_show_sql, needs_db=False)

    s = sub.add_parser("check", help="verify the source user is read-only and the target schema matches")
    s.add_argument("--skip-source", action="store_true")
    s.add_argument("--skip-target", action="store_true")
    s.set_defaults(func=cmd_check, needs_db=True)

    sub.add_parser("status", help="per-table checkpoint summary (no PHI)").set_defaults(func=cmd_status, needs_db=True)

    s = sub.add_parser("resync", help="force every row of a table to be re-applied (after a mapping change)")
    s.add_argument("--table", required=True)
    s.add_argument("--yes", action="store_true")
    s.set_defaults(func=cmd_resync, needs_db=True)

    s = sub.add_parser("run", help="poll continuously (or one pass with --once)")
    s.add_argument("--once", action="store_true")
    s.add_argument("--table", action="append", help="limit to these tables (repeatable)")
    s.set_defaults(func=cmd_run, needs_db=True)
    return p


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    try:
        if args.needs_db:
            settings = load_settings(args.env_file)
        else:  # validate / show-sql need only the mappings folder, no credentials
            load_env(args.env_file)
            settings = argparse.Namespace(
                engine=argparse.Namespace(mappings_dir=mappings_dir_from_env(), log_level="INFO")
            )
        setup_logging(settings.engine.log_level)
        return args.func(args, settings)
    except (ConfigError, MappingError, UnsafeSourceError, FingerprintMismatch) as exc:
        setup_logging()
        log.error(str(exc), extra={"error": type(exc).__name__})
        return 2
    except (pymysql.MySQLError, psycopg.Error, OSError) as exc:
        # Driver messages can echo values; the JSON formatter masks PHI-shaped content.
        setup_logging()
        log.error("database error: %s", exc, extra={"error": type(exc).__name__})
        return 3


if __name__ == "__main__":
    sys.exit(main())
