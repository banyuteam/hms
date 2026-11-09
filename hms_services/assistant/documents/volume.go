package documents

import (
	"crypto/rand"
	"errors"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"regexp"
	"time"
)

// Volume stores files on the document volume under generated keys (yyyy/mm/<uuid>), never a user-supplied name.
// Files are written to a temporary name and renamed, so a reader never sees a half-written file, with owner-only
// permissions.
type Volume struct{ Dir string }

var keyPattern = regexp.MustCompile(`^[0-9]{4}/[0-9]{2}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$`)

// ErrBadKey: a storage key that hms-services would never generate.
var ErrBadKey = errors.New("invalid storage key")

func (v Volume) path(key string) (string, error) {
	if !keyPattern.MatchString(key) {
		return "", ErrBadKey
	}
	return filepath.Join(v.Dir, filepath.FromSlash(key)), nil
}

// Save writes the file for document id and returns its storage key.
func (v Volume) Save(now time.Time, id string, b []byte) (string, error) {
	now = now.UTC()
	key := fmt.Sprintf("%04d/%02d/%s", now.Year(), int(now.Month()), id)
	p, err := v.path(key)
	if err != nil {
		return "", err
	}
	dir := filepath.Dir(p)
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return "", err
	}
	tmp, err := os.CreateTemp(dir, ".upload-*")
	if err != nil {
		return "", err
	}
	defer os.Remove(tmp.Name()) // no-op after a successful rename
	if _, err := tmp.Write(b); err != nil {
		tmp.Close()
		return "", err
	}
	if err := tmp.Sync(); err != nil {
		tmp.Close()
		return "", err
	}
	if err := tmp.Close(); err != nil {
		return "", err
	}
	if err := os.Rename(tmp.Name(), p); err != nil {
		return "", err
	}
	return key, nil
}

// Remove deletes a stored file; a file that is already gone is not an error.
func (v Volume) Remove(key string) error {
	p, err := v.path(key)
	if err != nil {
		return err
	}
	if err := os.Remove(p); err != nil && !errors.Is(err, fs.ErrNotExist) {
		return err
	}
	return nil
}

// newID returns a random (version 4) UUID in lower case.
func newID() string {
	var b [16]byte
	_, _ = rand.Read(b[:])
	b[6] = b[6]&0x0f | 0x40
	b[8] = b[8]&0x3f | 0x80
	return fmt.Sprintf("%x-%x-%x-%x-%x", b[0:4], b[4:6], b[6:8], b[8:10], b[10:])
}
