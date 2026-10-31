"""The polling engine: plans ranges, schedules them, and reconciles each range by hash.

Per due range (see BUILD-PLAN.md §3):
  level 1  source digest (count + XOR of row-hash prefixes) vs checkpoint -> skip if equal
  level 2  keyset-paginated (key, row hash) in a read-only snapshot, diffed against cdc.row_state
  level 3  fetch the inserted/updated rows in the same snapshot
  apply    mirror + row_state + change events + checkpoint (+ split) in one PostgreSQL transaction
"""

from __future__ import annotations

import logging
import threading
import time
from dataclasses import dataclass, field
from typing import Iterable, Protocol

from .config import EngineSettings
from .diff import (
    RESYNC_HASH,
    Key,
    boundaries_to_ranges,
    diff_range,
    digest_of,
    event_id,
    int_range_boundaries,
    next_interval_s,
    pk_key,
    split_boundaries,
)
from .mapping import TableMapping
from .target import ChangeEvent, NewRange, Range

log = logging.getLogger(__name__)


class SourcePort(Protocol):
    rows_read: int

    def digest(self, mapping: TableMapping, lower: Key | None, upper: Key | None) -> tuple[int, str]: ...
    def key_hashes(self, mapping: TableMapping, lower: Key | None, upper: Key | None) -> list[tuple[Key, str]]: ...
    def fetch_rows(self, mapping: TableMapping, keys, batch_size: int) -> dict: ...
    def next_boundary(self, mapping: TableMapping, lower: Key | None, size: int) -> Key | None: ...
    def min_max(self, mapping: TableMapping) -> tuple: ...
    def snapshot(self): ...
    def replica_lag_s(self) -> int | None: ...


class TokenBucket:
    """Limits rows read from the replica per second (0 = unlimited)."""

    def __init__(self, rate: int, sleep=time.sleep, clock=time.monotonic) -> None:
        self.rate = rate
        self._sleep = sleep
        self._clock = clock
        self._tokens = float(rate)
        self._last = clock()

    def consume(self, n: int) -> None:
        if self.rate <= 0 or n <= 0:
            return
        now = self._clock()
        self._tokens = min(float(self.rate), self._tokens + (now - self._last) * self.rate)
        self._last = now
        self._tokens -= n
        if self._tokens < 0:
            wait = -self._tokens / self.rate
            self._sleep(wait)
            self._last = self._clock()
            self._tokens = 0.0


@dataclass
class PassStats:
    ranges_scanned: int = 0
    ranges_changed: int = 0
    ranges_split: int = 0
    rows_read: int = 0
    inserts: int = 0
    updates: int = 0
    deletes: int = 0
    tables: dict[str, dict[str, int]] = field(default_factory=dict)

    def as_dict(self) -> dict[str, int]:
        return {
            "ranges_scanned": self.ranges_scanned,
            "ranges_changed": self.ranges_changed,
            "ranges_split": self.ranges_split,
            "rows_read": self.rows_read,
            "inserts": self.inserts,
            "updates": self.updates,
            "deletes": self.deletes,
        }


class Engine:
    def __init__(self, source: SourcePort, target, settings: EngineSettings, stop: threading.Event | None = None):
        self.source = source
        self.target = target
        self.settings = settings
        self.stop = stop or threading.Event()
        self.bucket = TokenBucket(settings.max_source_rows_per_second)

    # -- range planning ---------------------------------------------------------------------

    def plan_ranges(self, mapping: TableMapping) -> int:
        """Cut the key space into fixed-size ranges (decision 1). Returns the number of ranges."""
        if mapping.key_strategy == "int_range":
            lo, hi = self.source.min_max(mapping)
            bounds = int_range_boundaries(
                None if lo is None else int(lo), None if hi is None else int(hi), mapping.range_size
            )
        else:
            bounds = []
            lower: Key | None = None
            while not self.stop.is_set():
                nxt = self.source.next_boundary(mapping, lower, mapping.range_size)
                if nxt is None:
                    break
                bounds.append(nxt)
                lower = nxt
                self.bucket.consume(mapping.range_size)
        ranges = boundaries_to_ranges(bounds)
        self.target.create_ranges(mapping.table, ranges)
        log.info("ranges planned", extra={"table": mapping.table, "ranges": len(ranges)})
        return len(ranges)

    # -- one range --------------------------------------------------------------------------

    def process_range(self, mapping: TableMapping, rng: Range, pass_no: int, stats: PassStats) -> None:
        before = self.source.rows_read
        try:
            self._process_range(mapping, rng, pass_no, stats)
        finally:
            read = self.source.rows_read - before
            stats.rows_read += read
            self.bucket.consume(read)

    def _process_range(self, mapping: TableMapping, rng: Range, pass_no: int, stats: PassStats) -> None:
        stats.ranges_scanned += 1
        hot, cold = mapping.hot_interval_s, mapping.cold_interval_s

        # Level 1: digest. Skipped for never-scanned (or resynced) ranges: they always need level 2.
        if rng.digest is not None:
            n, digest = self.source.digest(mapping, rng.lower, rng.upper)
            if n == rng.row_count and digest == rng.digest:
                interval = next_interval_s(False, rng.unchanged_streak + 1, hot, cold, rng.is_tail)
                self.target.mark_unchanged(rng, interval, pass_no)
                return

        # Levels 2 and 3 in one consistent read-only snapshot.
        with self.source.snapshot():
            pairs = self.source.key_hashes(mapping, rng.lower, rng.upper)
            src = {pk_key(k): h for k, h in pairs}
            tgt = self.target.row_state(mapping.table, rng.range_id)
            d = diff_range(src, tgt)
            key_by_pk = {pk_key(k): k for k, _ in pairs}
            wanted = [key_by_pk[k] for k in (*d.inserts, *d.updates)]
            rows = self.source.fetch_rows(mapping, wanted, self.settings.fetch_batch_size) if wanted else {}

        snapshot_read = rng.digest is None
        events: list[ChangeEvent] = []
        for k in d.inserts:
            op = "r" if snapshot_read else "c"
            events.append(ChangeEvent(op, k, None, src[k], event_id(mapping.table, k, op, None, src[k], pass_no, rng.range_id)))
        for k in d.updates:
            op = "r" if tgt[k] == RESYNC_HASH else "u"
            before_h = None if op == "r" else tgt[k]
            events.append(ChangeEvent(op, k, before_h, src[k], event_id(mapping.table, k, op, before_h, src[k], pass_no, rng.range_id)))
        for k in d.deletes:
            events.append(ChangeEvent("d", k, tgt[k], None, event_id(mapping.table, k, "d", tgt[k], None, pass_no, rng.range_id)))

        # Split a range that outgrew 2 x size (decision 1: keep ranges fixed-size).
        keys_sorted = [k for k, _ in pairs]
        bounds = split_boundaries(keys_sorted, mapping.range_size, mapping.key_strategy, rng.lower)
        new_ranges: list[NewRange] = []
        new_upper = rng.upper
        own_hashes = [h for _, h in pairs]
        if bounds:
            edges = [*bounds, rng.upper]
            positions = _positions(keys_sorted, bounds)
            own_hashes = own_hashes[: positions[0]]
            new_upper = bounds[0]
            for i, b in enumerate(bounds):
                start = positions[i]
                end = positions[i + 1] if i + 1 < len(positions) else len(pairs)
                chunk = pairs[start:end]
                n, dg = digest_of(h for _, h in chunk)
                new_ranges.append(NewRange(b, edges[i + 1], n, dg, [pk_key(k) for k, _ in chunk]))
            stats.ranges_split += 1

        row_count, digest = digest_of(own_hashes)
        changed = d.changed or rng.row_count != len(pairs)
        interval = next_interval_s(changed, rng.unchanged_streak + 1, hot, cold, rng.is_tail)
        self.target.apply_range(
            mapping, rng, pass_no, rows, d.deletes, events, row_count, digest,
            interval, changed, new_upper, new_ranges,
        )
        if d.changed:
            stats.ranges_changed += 1
        stats.inserts += len(d.inserts)
        stats.updates += len(d.updates)
        stats.deletes += len(d.deletes)
        if d.changed or bounds:
            log.info(
                "range reconciled",
                extra={
                    "table": mapping.table,
                    "range_id": rng.range_id,
                    "inserts": len(d.inserts),
                    "updates": len(d.updates),
                    "deletes": len(d.deletes),
                    "split_into": len(new_ranges) + 1 if new_ranges else 0,
                },
            )

    # -- passes -----------------------------------------------------------------------------

    def run_table_pass(self, mapping: TableMapping) -> PassStats:
        """Scan the due ranges of one table. Each range commits independently (decision 3)."""
        stats = PassStats()
        if not self.target.try_lock_table(mapping.table):
            log.warning("table locked by another instance, skipping", extra={"table": mapping.table})
            return stats
        try:
            if self.target.ensure_table_state(mapping):
                self.plan_ranges(mapping)
            due = self.target.due_ranges(mapping.table, self.settings.max_ranges_per_pass)
            if not due:
                return stats
            pass_no = self.target.begin_pass(mapping.table)
            error = None
            try:
                for rng in due:
                    if self.stop.is_set():
                        break
                    self.process_range(mapping, rng, pass_no, stats)
                    if self.settings.throttle_sleep_ms:
                        self.stop.wait(self.settings.throttle_sleep_ms / 1000)
            except Exception as exc:
                error = type(exc).__name__
                raise
            finally:
                self.target.finish_pass(mapping.table, stats.as_dict(), error)
                log.info("pass finished", extra={"table": mapping.table, "pass_no": pass_no, **stats.as_dict()})
        finally:
            self.target.unlock_table(mapping.table)
        return stats

    def run_once(self, mappings: Iterable[TableMapping]) -> PassStats:
        total = PassStats()
        for mapping in mappings:
            if self.stop.is_set():
                break
            if not mapping.enabled:
                continue
            if not self._replica_ok():
                break
            s = self.run_table_pass(mapping)
            total.tables[mapping.table] = s.as_dict()
            for k, v in s.as_dict().items():
                setattr(total, k, getattr(total, k) + v)
        return total

    def run_forever(self, mappings: list[TableMapping]) -> None:
        failures = 0
        while not self.stop.is_set():
            try:
                stats = self.run_once(mappings)
                failures = 0
            except Exception as exc:  # keep polling; a failed range is retried on its next due time
                failures += 1
                backoff = min(300, self.settings.idle_sleep_s * 2 ** min(failures, 6))
                log.error("pass failed", extra={"error": type(exc).__name__, "retry_in_s": backoff})
                self.stop.wait(backoff)
                continue
            if stats.ranges_scanned == 0:
                self.stop.wait(self.settings.idle_sleep_s)

    def _replica_ok(self) -> bool:
        limit = getattr(self.source, "max_replica_lag_s", 0) or 0
        if limit <= 0:
            return True
        lag = self.source.replica_lag_s()
        if lag is not None and lag > limit:
            log.warning("replica lag above limit, pausing", extra={"lag_s": lag, "limit_s": limit})
            self.stop.wait(self.settings.idle_sleep_s)
            return False
        return True


def _positions(keys_sorted: list[Key], bounds: list[Key]) -> list[int]:
    """Index of each boundary key inside the sorted key list (boundaries are taken from it)."""
    index = {k: i for i, k in enumerate(keys_sorted)}
    out = []
    for b in bounds:
        if b in index:
            out.append(index[b])
        else:  # int_range boundary that is not itself a key: first key >= boundary
            out.append(next(i for i, k in enumerate(keys_sorted) if k >= b))
    return out
