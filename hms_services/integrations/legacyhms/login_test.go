package legacyhms

import (
	"context"
	"encoding/hex"
	"errors"
	"fmt"
	"regexp"
	"strings"
	"testing"
)

// Reference values recorded from MariaDB 10.6 (the dev legacy server, 2026-11-06):
// SELECT AES_ENCRYPT(plain, key) with made-up inputs.
var mariadbVectors = []struct{ plain, key, hex string }{
	{"D001", "test-key", "126246eaaa0e14b09c57778e5b8fd51f"},
	{"", "k", "932f1b1e9189536b938a6b67666d4031"},
	{"exactly-16-bytes", "a-key-longer-than-sixteen-bytes!!", "e4566bd6d0d7f3bb2e51b2b1462c2061705200bb119244e46cada6bb8a0a5761"},
	{"Ünïcode 12345678901234567890", "kunci", "d298b9147672e42f3833666d0cd74208c05881df74bbfcf421b419bc8b0f69d5"},
}

func TestAESEncryptMatchesMariaDB(t *testing.T) {
	for _, v := range mariadbVectors {
		if got := hex.EncodeToString(AESEncrypt([]byte(v.plain), []byte(v.key))); got != v.hex {
			t.Errorf("AES_ENCRYPT(%q, %q) = %s, MariaDB gives %s", v.plain, v.key, got, v.hex)
		}
	}
}

// fakeLegacy is a tiny in-memory legacy HMS that answers the checker's statements.
type fakeLegacy struct {
	idKey, pwKey []byte
	logins       map[string]string    // user ID -> password
	doctors      map[string]string    // active kd_dokter -> name
	employees    map[string][2]string // active login value (nik) -> {pegawai.id, name}
	down         bool
	seen         []string
}

type row struct {
	vals []any
	err  error
}

func (r row) Scan(dest ...any) error {
	if r.err != nil {
		return r.err
	}
	for i, d := range dest {
		switch p := d.(type) {
		case *int:
			*p = r.vals[i].(int)
		case *string:
			*p = r.vals[i].(string)
		}
	}
	return nil
}

func (f *fakeLegacy) QueryRow(_ context.Context, q string, args ...any) Row {
	f.seen = append(f.seen, q)
	if f.down {
		return row{err: errors.New("connection refused")}
	}
	switch {
	case strings.Contains(q, "FROM `user`"):
		for id, pw := range f.logins {
			if args[0].(string) == HexUpper(AESEncrypt([]byte(id), f.idKey)) &&
				args[1].(string) == HexUpper(AESEncrypt([]byte(pw), f.pwKey)) {
				return row{vals: []any{1}}
			}
		}
	case strings.Contains(q, "FROM `dokter`"):
		if name, ok := f.doctors[args[0].(string)]; ok {
			return row{vals: []any{name}}
		}
	case strings.Contains(q, "FROM `pegawai` WHERE `id`"):
		for _, e := range f.employees {
			if e[0] == args[0].(string) {
				return row{vals: []any{e[1]}}
			}
		}
	case strings.Contains(q, "FROM `pegawai`"):
		if e, ok := f.employees[args[0].(string)]; ok {
			return row{vals: []any{e[0], e[1]}}
		}
	}
	return row{err: ErrNoRows}
}

func newFake() *fakeLegacy {
	return &fakeLegacy{
		idKey: []byte("id-key"), pwKey: []byte("pw-key"),
		logins:    map[string]string{"D001": "doc-pass", "3301": "emp-pass", "D002": "gone-pass", "BOTH": "both-pass"},
		doctors:   map[string]string{"D001": " dr. Test ", "BOTH": "dr. Both"},
		employees: map[string][2]string{"3301": {"17", "Test Employee"}, "BOTH": {"18", "Both as employee"}},
	}
}

func newChecker(t *testing.T, f *fakeLegacy) *Checker {
	t.Helper()
	c, err := NewChecker(f, f.idKey, f.pwKey, "nik")
	if err != nil {
		t.Fatal(err)
	}
	return c
}

func TestLoginComparesHexNotRawBytes(t *testing.T) {
	c := newChecker(t, newFake())
	if !strings.Contains(c.Statements()[0], "HEX(`id_user`) = ?") || !strings.Contains(c.Statements()[0], "HEX(`password`) = ?") {
		t.Errorf("login must compare HEX strings (charset-safe): %s", c.Statements()[0])
	}
	if got := HexUpper([]byte{0x0a, 0xff}); got != "0AFF" {
		t.Errorf("HexUpper = %s, MySQL HEX() gives 0AFF", got)
	}
}

func TestOnlyFixedReadOnlyStatements(t *testing.T) {
	f := newFake()
	c := newChecker(t, f)
	allowed := regexp.MustCompile("^SELECT .* FROM `(user|dokter|pegawai)` WHERE .* LIMIT 1$")
	for _, s := range c.Statements() {
		if !allowed.MatchString(s) {
			t.Errorf("statement outside the allowlist: %s", s)
		}
	}
	_, _ = c.Verify(context.Background(), "3301", "emp-pass")
	_, _ = c.Active(context.Background(), IssuerEmployee, "17")
	for _, q := range f.seen {
		found := false
		for _, s := range c.Statements() {
			found = found || q == s
		}
		if !found {
			t.Errorf("unexpected statement sent: %s", q)
		}
	}
}

func TestVerify(t *testing.T) {
	ctx := context.Background()
	c := newChecker(t, newFake())

	id, err := c.Verify(ctx, "D001", "doc-pass")
	if err != nil || id != (Identity{Issuer: IssuerDoctor, Subject: "D001", DisplayName: "dr. Test"}) {
		t.Errorf("doctor: got %+v, %v", id, err)
	}
	id, err = c.Verify(ctx, "3301", "emp-pass")
	if err != nil || id != (Identity{Issuer: IssuerEmployee, Subject: "17", DisplayName: "Test Employee"}) {
		t.Errorf("employee maps to pegawai.id: got %+v, %v", id, err)
	}
	if id, _ = c.Verify(ctx, "BOTH", "both-pass"); id.Issuer != IssuerDoctor {
		t.Errorf("doctor first: got %+v", id)
	}
	for _, tc := range []struct{ user, pw string }{
		{"D001", "wrong"}, {"nobody", "doc-pass"}, {"D002", "gone-pass"}, {"", "x"}, {"D001", ""},
	} {
		if _, err := c.Verify(ctx, tc.user, tc.pw); !errors.Is(err, ErrInvalid) {
			t.Errorf("Verify(%q, %q) = %v, want ErrInvalid", tc.user, tc.pw, err)
		}
	}
}

func TestVerifyReportsOutage(t *testing.T) {
	f := newFake()
	f.down = true
	if _, err := newChecker(t, f).Verify(context.Background(), "D001", "doc-pass"); err == nil || errors.Is(err, ErrInvalid) {
		t.Errorf("outage must not look like a wrong password: %v", err)
	}
}

func TestActive(t *testing.T) {
	ctx := context.Background()
	c := newChecker(t, newFake())
	for _, tc := range []struct {
		issuer, subject string
		want            bool
	}{
		{IssuerDoctor, "D001", true}, {IssuerDoctor, "D002", false}, {IssuerEmployee, "17", true}, {IssuerEmployee, "99", false},
	} {
		if got, err := c.Active(ctx, tc.issuer, tc.subject); err != nil || got != tc.want {
			t.Errorf("Active(%s, %s) = %v, %v", tc.issuer, tc.subject, got, err)
		}
	}
	if _, err := c.Active(ctx, "oidc", "x"); err == nil {
		t.Error("unknown issuer must be an error")
	}
}

func TestAESDecryptRoundTripAndWrongKey(t *testing.T) {
	for _, v := range mariadbVectors {
		ct, _ := hex.DecodeString(v.hex)
		if got, ok := AESDecrypt(ct, []byte(v.key)); !ok || string(got) != v.plain {
			t.Errorf("decrypt %s = %q %v", v.hex, got, ok)
		}
	}
	// A wrong key must fail on (almost) every value: check a few hundred encrypted IDs.
	failures := 0
	for i := 0; i < 300; i++ {
		ct := AESEncrypt([]byte(fmt.Sprintf("ID%05d", i)), []byte("right-key"))
		if _, ok := AESDecrypt(ct, []byte("wrong-key")); !ok {
			failures++
		}
	}
	if failures < 280 {
		t.Errorf("wrong key accepted too often: %d/300 rejected", failures)
	}
	if _, ok := AESDecrypt([]byte("short"), []byte("k")); ok {
		t.Error("partial block accepted")
	}
}

func TestKeyCheckStatementIsReadOnlyAndSkipsPasswords(t *testing.T) {
	if !strings.HasPrefix(keyCheckSQL, "SELECT HEX(`id_user`) FROM `user`") || strings.Contains(keyCheckSQL, "password") {
		t.Errorf("key check statement must read only id_user: %s", keyCheckSQL)
	}
}

func TestNewCheckerRefusesBadConfig(t *testing.T) {
	f := newFake()
	if _, err := NewChecker(f, nil, []byte("k"), "nik"); err == nil {
		t.Error("missing key accepted")
	}
	if _, err := NewChecker(f, []byte("k"), []byte("k"), "nik`; DROP"); err == nil {
		t.Error("unsafe column accepted")
	}
}
