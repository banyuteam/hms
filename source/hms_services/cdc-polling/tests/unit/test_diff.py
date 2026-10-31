import datetime as dt
import hashlib
from decimal import Decimal

from khanza_cdc import diff


def md5(s: str) -> str:
    return hashlib.md5(s.encode()).hexdigest()


def test_diff_detects_insert_update_delete():
    source = {"a": md5("1"), "b": md5("2-new"), "d": md5("4")}
    target = {"a": md5("1"), "b": md5("2"), "c": md5("3")}
    d = diff.diff_range(source, target)
    assert d.inserts == ["d"]
    assert d.updates == ["b"]
    assert d.deletes == ["c"]
    assert d.changed


def test_diff_unchanged():
    same = {"a": md5("1")}
    assert not diff.diff_range(same, dict(same)).changed


def test_digest_is_order_independent_and_counts():
    hashes = [md5(str(i)) for i in range(50)]
    n1, d1 = diff.digest_of(hashes)
    n2, d2 = diff.digest_of(reversed(hashes))
    assert (n1, d1) == (n2, d2) == (50, d1)
    assert len(d1) == 16


def test_digest_of_empty_range():
    assert diff.digest_of([]) == (0, "0000000000000000")


def test_digest_changes_when_one_row_changes():
    hashes = [md5(str(i)) for i in range(10)]
    changed = hashes[:5] + [md5("x")] + hashes[6:]
    assert diff.digest_of(hashes) != diff.digest_of(changed)


def test_pk_key_is_canonical_for_mixed_types():
    key = ("2026/10/30/000001", 3, dt.date(2026, 10, 30), dt.timedelta(hours=8, minutes=5), Decimal("1.50"))
    assert diff.pk_key(key) == '["2026/10/30/000001",3,"2026-10-30","08:05:00","1.50"]'


def test_keyset_split_every_size_keys_with_remainder_in_last_chunk():
    keys = [(f"k{i:03d}",) for i in range(23)]
    assert diff.split_boundaries(keys, 5, "keyset", None) == [("k005",), ("k010",), ("k015",)]
    # 23 keys -> chunks 5, 5, 5, 8 (last chunk between size and 2*size-1)


def test_no_split_until_twice_the_size():
    keys = [(i,) for i in range(10)]
    assert diff.split_boundaries(keys, 5, "keyset", None) == []


def test_int_range_split_on_fixed_width_multiples():
    keys = [(i,) for i in range(100, 125)]
    assert diff.split_boundaries(keys, 10, "int_range", (100,)) == [(110,), (120,)]


def test_int_range_boundaries_and_ranges_cover_whole_key_space():
    bounds = diff.int_range_boundaries(3, 27, 10)
    assert bounds == [(10,), (20,)]
    assert diff.boundaries_to_ranges(bounds) == [(None, (10,)), ((10,), (20,)), ((20,), None)]
    assert diff.int_range_boundaries(None, None, 10) == []
    assert diff.boundaries_to_ranges([]) == [(None, None)]


def test_adaptive_interval_backs_off_to_cold_and_tail_stays_hot():
    assert diff.next_interval_s(True, 9, 60, 3600, False) == 60
    assert diff.next_interval_s(False, 1, 60, 3600, False) == 120
    assert diff.next_interval_s(False, 3, 60, 3600, False) == 480
    assert diff.next_interval_s(False, 50, 60, 3600, False) == 3600
    assert diff.next_interval_s(False, 50, 60, 3600, True) == 60


def test_event_id_is_deterministic():
    a = diff.event_id("t", '["k"]', "u", "h1", "h2", 3, 7)
    b = diff.event_id("t", '["k"]', "u", "h1", "h2", 3, 7)
    c = diff.event_id("t", '["k"]', "u", "h1", "h2", 4, 7)
    assert a == b != c
