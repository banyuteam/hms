package legacyhms

import (
	"context"
	"crypto/aes"
	"database/sql"
	"encoding/hex"
	"errors"
	"fmt"
)

// AESDecrypt reverses AESEncrypt. ok is false when the input is not whole blocks or the padding is invalid, which is
// what a wrong key produces for almost every value (a random final block has valid padding about 1 time in 256).
func AESDecrypt(cipherText, key []byte) (plain []byte, ok bool) {
	if len(cipherText) == 0 || len(cipherText)%16 != 0 {
		return nil, false
	}
	k := make([]byte, 16)
	for i, b := range key {
		k[i%16] ^= b
	}
	block, _ := aes.NewCipher(k)
	out := make([]byte, len(cipherText))
	for i := 0; i < len(cipherText); i += 16 {
		block.Decrypt(out[i:i+16], cipherText[i:i+16])
	}
	pad := int(out[len(out)-1])
	if pad < 1 || pad > 16 {
		return nil, false
	}
	for _, b := range out[len(out)-pad:] {
		if int(b) != pad {
			return nil, false
		}
	}
	return out[:len(out)-pad], true
}

// KeyReport is the outcome of CheckIDKey: counts only.
type KeyReport struct {
	Accounts        int // rows in `user`
	BlockAligned    int // id_user values that are whole AES blocks (expected: all)
	Decoded         int // id_user values that decode with the ID key
	DecodedSwapped  int // id_user values that decode with the password key instead (keys swapped?)
	ReEncrypted     int // decoded IDs whose AESEncrypt equals the stored HEX exactly (what the login query compares)
	ActiveDoctors   int // decoded IDs that are active doctors
	ActiveEmployees int // decoded IDs that are active employees (via the employee login column), not doctors
	Neither         int // decoded IDs that are neither (inactive staff or other accounts)
}

// keyCheckSQL is the only extra statement of the key check. The password column is never read.
// HEX() returns the stored bytes as ASCII, so no character-set conversion can alter them on the way.
const keyCheckSQL = "SELECT HEX(`id_user`) FROM `user` LIMIT 20000"

// CheckIDKey tests the ID key against the stored user IDs and resolves each decoded ID with the checker's fixed
// statements. No ID, key or password is returned, logged or sent to the server.
func CheckIDKey(ctx context.Context, db *sql.DB, c *Checker) (KeyReport, error) {
	rows, err := db.QueryContext(ctx, keyCheckSQL)
	if err != nil {
		return KeyReport{}, fmt.Errorf("read user table: %w", err)
	}
	var ids []string
	var r KeyReport
	for rows.Next() {
		var h string
		if err := rows.Scan(&h); err != nil {
			rows.Close()
			return KeyReport{}, err
		}
		enc, _ := hex.DecodeString(h)
		r.Accounts++
		if len(enc) > 0 && len(enc)%16 == 0 {
			r.BlockAligned++
		}
		if plain, ok := AESDecrypt(enc, c.idKey); ok {
			ids = append(ids, string(plain))
			if HexUpper(AESEncrypt(plain, c.idKey)) == h {
				r.ReEncrypted++
			}
		}
		if _, ok := AESDecrypt(enc, c.passwordKey); ok {
			r.DecodedSwapped++
		}
	}
	if err := rows.Err(); err != nil {
		return KeyReport{}, err
	}
	rows.Close()
	r.Decoded = len(ids)
	for _, id := range ids {
		ident, err := c.Resolve(ctx, id)
		switch {
		case errors.Is(err, ErrInvalid):
			r.Neither++
		case err != nil:
			return KeyReport{}, fmt.Errorf("resolve staff: %w", err)
		case ident.Issuer == IssuerDoctor:
			r.ActiveDoctors++
		default:
			r.ActiveEmployees++
		}
	}
	return r, nil
}
