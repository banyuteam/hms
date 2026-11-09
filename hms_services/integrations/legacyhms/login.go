// Package legacyhms reads the legacy HMS (Khanza, MySQL/MariaDB) strictly read-only. This file verifies staff
// sign-ins against the legacy `user` table and resolves the person to an active doctor or employee
// (owner decisions; ADR-SVC-001 and ADR-DB-003).
//
// Khanza stores user.id_user and user.password as MySQL AES_ENCRYPT values. The check encrypts the typed ID and
// password here with the same algorithm and compares the stored bytes, so neither the password nor the keys are ever
// sent to the database (they cannot reach its query log) and no stored password is decrypted.
//
// Only the four fixed statements in Statements() are ever sent; a test enforces it.
package legacyhms

import (
	"context"
	"crypto/aes"
	"encoding/hex"
	"errors"
	"fmt"
	"regexp"
	"strings"
)

// AESEncrypt is MySQL/MariaDB AES_ENCRYPT(plain, key) in the default aes-128-ecb mode: the key is folded into 16 bytes
// by XOR, the input is PKCS#7-padded and each block is encrypted independently.
func AESEncrypt(plain, key []byte) []byte {
	k := make([]byte, 16)
	for i, b := range key {
		k[i%16] ^= b
	}
	block, _ := aes.NewCipher(k) // a 16-byte key cannot fail
	pad := 16 - len(plain)%16
	buf := make([]byte, len(plain)+pad)
	copy(buf, plain)
	for i := len(plain); i < len(buf); i++ {
		buf[i] = byte(pad)
	}
	out := make([]byte, len(buf))
	for i := 0; i < len(buf); i += 16 {
		block.Encrypt(out[i:i+16], buf[i:i+16])
	}
	return out
}

// Row is one result row; *sql.Row satisfies it.
type Row interface{ Scan(dest ...any) error }

// Querier runs one read-only query returning at most one row (see QuerierFor). ErrNoRows must be reported as
// ErrNoRows.
type Querier interface {
	QueryRow(ctx context.Context, query string, args ...any) Row
}

// Issuers of the legacy identities, as stored in iam.external_identities.issuer.
const (
	IssuerDoctor   = "legacy-hms:dokter"
	IssuerEmployee = "legacy-hms:pegawai"
)

// Identity is the person a valid legacy login resolved to.
type Identity struct {
	Issuer      string // IssuerDoctor or IssuerEmployee
	Subject     string // dokter.kd_dokter or pegawai.id
	DisplayName string // dokter.nm_dokter or pegawai.nama; may be empty
}

var (
	// ErrInvalid covers a wrong user ID, a wrong password and a person who is not an active doctor or employee:
	// callers answer all of them alike.
	ErrInvalid = errors.New("legacyhms: invalid credentials")
	// ErrNoRows is what a Querier's Row reports when nothing matched.
	ErrNoRows = errors.New("legacyhms: no rows")

	column = regexp.MustCompile(`^[A-Za-z_][A-Za-z0-9_]{0,63}$`)
)

// Checker verifies legacy logins. Its statements are fixed at construction.
type Checker struct {
	db          Querier
	idKey       []byte
	passwordKey []byte
	qLogin      string // user ID + password match a legacy account
	qDoctor     string // kd_dokter is an active doctor; returns the name
	qEmpLogin   string // the login column value is an active employee; returns pegawai.id and the name
	qEmpActive  string // pegawai.id is an active employee; returns the name
}

// NewChecker builds the checker. employeeField is the pegawai column that legacy user IDs hold for employees
// (reference default nik; verify on the legacy data).
func NewChecker(db Querier, idKey, passwordKey []byte, employeeField string) (*Checker, error) {
	if len(idKey) == 0 || len(passwordKey) == 0 {
		return nil, errors.New("legacyhms: both login keys are required")
	}
	if !column.MatchString(employeeField) {
		return nil, fmt.Errorf("legacyhms: invalid employee login column %q", employeeField)
	}
	return &Checker{
		db:          db,
		idKey:       idKey,
		passwordKey: passwordKey,
		// The AES values are binary data in text columns: MySQL re-encodes them in the connection character set (seen
		// on the dev server: 329 of 330 IDs altered), so both sides are compared as HEX, which is plain ASCII. The
		// table is small (hundreds of rows), so the scan this causes is cheap.
		qLogin:     "SELECT 1 FROM `user` WHERE HEX(`id_user`) = ? AND HEX(`password`) = ? LIMIT 1",
		qDoctor:    "SELECT COALESCE(`nm_dokter`, '') FROM `dokter` WHERE `kd_dokter` = ? AND `status` = '1' LIMIT 1",
		qEmpLogin:  "SELECT `id`, COALESCE(`nama`, '') FROM `pegawai` WHERE `" + employeeField + "` = ? AND `stts_aktif` = 'AKTIF' LIMIT 1",
		qEmpActive: "SELECT COALESCE(`nama`, '') FROM `pegawai` WHERE `id` = ? AND `stts_aktif` = 'AKTIF' LIMIT 1",
	}, nil
}

// Statements returns the only SQL this package sends.
func (c *Checker) Statements() []string {
	return []string{c.qLogin, c.qDoctor, c.qEmpLogin, c.qEmpActive}
}

// Verify checks a login and resolves the person, doctor first (owner decision: a user ID that is an active doctor
// signs in as the doctor). ErrInvalid for anything the user caused; another error when the database did not answer.
func (c *Checker) Verify(ctx context.Context, userID, password string) (Identity, error) {
	if userID == "" || password == "" {
		return Identity{}, ErrInvalid
	}
	var one int
	err := c.db.QueryRow(ctx, c.qLogin, HexUpper(AESEncrypt([]byte(userID), c.idKey)),
		HexUpper(AESEncrypt([]byte(password), c.passwordKey))).Scan(&one)
	if err != nil {
		return Identity{}, notFoundAs(err, ErrInvalid)
	}
	return c.Resolve(ctx, userID)
}

// Resolve maps a legacy user ID to an active doctor (first) or active employee, without checking a password. Used
// after a verified login and by the key check (counts only). ErrInvalid when the ID is neither.
func (c *Checker) Resolve(ctx context.Context, userID string) (Identity, error) {
	var name string
	err := c.db.QueryRow(ctx, c.qDoctor, userID).Scan(&name)
	switch {
	case err == nil:
		return Identity{Issuer: IssuerDoctor, Subject: userID, DisplayName: strings.TrimSpace(name)}, nil
	case !errors.Is(err, ErrNoRows):
		return Identity{}, err
	}

	var id string
	err = c.db.QueryRow(ctx, c.qEmpLogin, userID).Scan(&id, &name)
	if err != nil {
		return Identity{}, notFoundAs(err, ErrInvalid)
	}
	return Identity{Issuer: IssuerEmployee, Subject: id, DisplayName: strings.TrimSpace(name)}, nil
}

// Active reports whether the identity is still an active doctor or employee in the legacy HMS.
func (c *Checker) Active(ctx context.Context, issuer, subject string) (bool, error) {
	var q string
	switch issuer {
	case IssuerDoctor:
		q = c.qDoctor
	case IssuerEmployee:
		q = c.qEmpActive
	default:
		return false, fmt.Errorf("legacyhms: unknown issuer %q", issuer)
	}
	var name string
	err := c.db.QueryRow(ctx, q, subject).Scan(&name)
	switch {
	case err == nil:
		return true, nil
	case errors.Is(err, ErrNoRows):
		return false, nil
	default:
		return false, err
	}
}

// HexUpper formats bytes as MySQL HEX() does.
func HexUpper(b []byte) string { return strings.ToUpper(hex.EncodeToString(b)) }

func notFoundAs(err, as error) error {
	if errors.Is(err, ErrNoRows) {
		return as
	}
	return err
}
