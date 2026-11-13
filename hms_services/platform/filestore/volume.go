package filestore

import (
	"bytes"
	"crypto/sha256"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"time"
)

// Volume stores one feature's files under <dir>/<namespace>/yyyy/mm/<id>. Files are written to a temporary name,
// synced and renamed, so a reader never sees a half-written file, and are readable by the service user only.
type Volume struct {
	dir       string
	namespace string
	keys      *regexp.Regexp
}

var (
	ErrBadKey    = errors.New("filestore: invalid storage key")
	ErrNotFound  = errors.New("filestore: file not found")
	ErrIntegrity = errors.New("filestore: stored file does not match its hash")

	namespacePattern = regexp.MustCompile(`^[a-z][a-z0-9-]{1,30}$`)
	idPattern        = regexp.MustCompile(`^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$`)
)

// NewVolume opens the namespace directory on the volume, creating it if needed, and checks that it is writable.
func NewVolume(dir, namespace string) (*Volume, error) {
	if !namespacePattern.MatchString(namespace) {
		return nil, fmt.Errorf("filestore: namespace %q is not lower-case", namespace)
	}
	if dir == "" {
		return nil, errors.New("filestore: volume directory is required")
	}
	v := &Volume{dir: dir, namespace: namespace,
		keys: regexp.MustCompile(`^` + namespace + `/[0-9]{4}/[0-9]{2}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$`)}
	root := filepath.Join(dir, namespace)
	if err := os.MkdirAll(root, 0o700); err != nil {
		return nil, fmt.Errorf("filestore: volume %s: %w", root, err)
	}
	probe, err := os.CreateTemp(root, ".probe-*")
	if err != nil {
		return nil, fmt.Errorf("filestore: volume %s is not writable: %w", root, err)
	}
	probe.Close()
	_ = os.Remove(probe.Name())
	return v, nil
}

func (v *Volume) path(key string) (string, error) {
	if !v.keys.MatchString(key) {
		return "", ErrBadKey
	}
	return filepath.Join(v.dir, filepath.FromSlash(key)), nil
}

// Save writes the file with id (a lower-case UUID, see NewID) and returns its storage key.
func (v *Volume) Save(now time.Time, id string, data []byte) (string, error) {
	if !idPattern.MatchString(id) {
		return "", ErrBadKey
	}
	now = now.UTC()
	key := fmt.Sprintf("%s/%04d/%02d/%s", v.namespace, now.Year(), int(now.Month()), id)
	p, err := v.path(key)
	if err != nil {
		return "", err
	}
	if err := os.MkdirAll(filepath.Dir(p), 0o700); err != nil {
		return "", err
	}
	if _, err := os.Lstat(p); err == nil {
		return "", fmt.Errorf("filestore: %s already exists", key)
	}
	tmp, err := os.CreateTemp(filepath.Dir(p), ".upload-*")
	if err != nil {
		return "", err
	}
	defer os.Remove(tmp.Name()) // no-op after a successful rename
	if _, err := tmp.Write(data); err != nil {
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

// Read returns the stored file after checking it against the SHA-256 recorded in the database.
func (v *Volume) Read(key string, want []byte) ([]byte, error) {
	p, err := v.path(key)
	if err != nil {
		return nil, err
	}
	f, err := os.Open(p)
	if errors.Is(err, fs.ErrNotExist) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	defer f.Close()
	data, err := io.ReadAll(io.LimitReader(f, MaxFileBytes+1))
	if err != nil {
		return nil, err
	}
	got := sha256.Sum256(data)
	if len(data) > MaxFileBytes || !bytes.Equal(got[:], want) {
		return nil, ErrIntegrity
	}
	return data, nil
}

// Remove deletes a stored file whose database row was never written (an upload that failed after Save). A file that
// is already gone is not an error. Files of committed rows are never removed by the features.
func (v *Volume) Remove(key string) error {
	p, err := v.path(key)
	if err != nil {
		return err
	}
	if err := os.Remove(p); err != nil && !errors.Is(err, fs.ErrNotExist) {
		return err
	}
	return nil
}

// Namespace is the volume's key prefix.
func (v *Volume) Namespace() string { return strings.Clone(v.namespace) }
