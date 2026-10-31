import pytest

from khanza_cdc.engine import TokenBucket
from khanza_cdc.logs import key_ref, mask_text
from khanza_cdc.source import UnsafeSourceError, assert_read_only_statement, unsafe_privileges


@pytest.mark.parametrize(
    "sql",
    [
        "SELECT 1",
        "  select * from t",
        "SHOW GRANTS FOR CURRENT_USER()",
        "SET SESSION TRANSACTION READ ONLY",
        "START TRANSACTION WITH CONSISTENT SNAPSHOT, READ ONLY",
        "COMMIT",
    ],
)
def test_read_statements_allowed(sql):
    assert_read_only_statement(sql)


@pytest.mark.parametrize(
    "sql",
    [
        "INSERT INTO t VALUES (1)",
        "UPDATE t SET a = 1",
        "DELETE FROM t",
        "DROP TABLE t",
        "CREATE TRIGGER x",
        "SET GLOBAL read_only = 0",
        "START TRANSACTION",
        "CALL proc()",
        "LOCK TABLES t READ",
    ],
)
def test_write_or_admin_statements_blocked(sql):
    with pytest.raises(UnsafeSourceError):
        assert_read_only_statement(sql)


def test_select_only_user_is_accepted():
    grants = [
        "GRANT USAGE ON *.* TO `cdc_reader`@`%`",
        "GRANT SELECT ON `khanza`.`pasien` TO `cdc_reader`@`%`",
        "GRANT SELECT (`no_rawat`, `stts`) ON `khanza`.`reg_periksa` TO `cdc_reader`@`%`",
    ]
    assert unsafe_privileges(grants) == set()


def test_write_privileges_are_detected():
    grants = [
        "GRANT SELECT, INSERT, UPDATE ON `khanza`.* TO `app`@`%`",
        "GRANT ALL PRIVILEGES ON *.* TO `root`@`localhost` WITH GRANT OPTION",
        "GRANT `some_role` TO `app`@`%`",
    ]
    assert unsafe_privileges(grants) == {"INSERT", "UPDATE", "ALL PRIVILEGES", "<unparsed grant>"}


def test_logs_mask_phi_shaped_numbers_and_key_details():
    text = 'nik 3201234567890123 bpjs 0001234567890 hp 081234567890 Key (no_rawat)=(2026/10/30/000001) exists'
    masked = mask_text(text)
    assert "3201234567890123" not in masked and "[NIK]" in masked
    assert "0001234567890" not in masked and "[BPJS]" in masked
    assert "081234567890" not in masked and "[PHONE]" in masked
    assert "2026/10/30/000001" not in masked and ")=([REDACTED])" in masked


def test_key_ref_is_pseudonymous():
    assert key_ref('["RM000123"]') == key_ref('["RM000123"]')
    assert "RM000123" not in key_ref('["RM000123"]')


def test_token_bucket_sleeps_when_over_rate():
    clock = [0.0]
    slept = []

    def sleep(s):
        slept.append(s)
        clock[0] += s

    bucket = TokenBucket(100, sleep=sleep, clock=lambda: clock[0])
    bucket.consume(100)
    assert slept == []
    bucket.consume(50)
    assert slept == [pytest.approx(0.5)]
