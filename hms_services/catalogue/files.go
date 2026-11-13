package catalogue

import (
	"context"
	"errors"
	"fmt"
	"slices"
	"strconv"

	"github.com/jackc/pgx/v5"

	"hms/services/platform/audit"
	"hms/services/platform/filestore"
)

// StoredFile is a file read back from the volume, verified against its SHA-256.
type StoredFile struct {
	Title     string
	MediaType string
	Extension string
	Data      []byte
}

// StoreFile checks, scans and stores the file of a file-type source, replacing any previous one. The version must be
// the one read; storing a file counts as a change of the source. Refusals are *filestore.Rejection and are audited.
func (s *Service) StoreFile(ctx context.Context, c Caller, id string, version int, data []byte) (Source, error) {
	if s.files == nil || s.scanner == nil {
		return Source{}, ErrFilesUnavailable
	}
	if !uuidLike(id) {
		return Source{}, ErrNotFound
	}
	var kind string
	err := s.db.QueryRow(ctx, `SELECT source_type FROM catalogue.sources WHERE id = $1 AND organization_id = $2`,
		id, c.OrganizationID).Scan(&kind)
	if errors.Is(err, pgx.ErrNoRows) {
		return Source{}, ErrNotFound
	} else if err != nil {
		return Source{}, err
	}
	allowed, ok := fileTypes[kind]
	if !ok {
		return Source{}, ValidationError{"file", "no_file", "A link has no file; change its address instead."}
	}
	// A supported file of the wrong type is named as such, and refused before it is scanned.
	if mt, err := filestore.Sniff(data); err == nil && !slices.Contains(allowed, mt) {
		s.RecordRefusal(ctx, c, id, RejectTypeMismatch)
		return Source{}, &filestore.Rejection{Code: RejectTypeMismatch}
	}
	acc, err := filestore.Accept(ctx, filestore.Policy{Allowed: allowed, MaxBytes: MaxFileBytes}, s.scanner, data)
	if err != nil {
		var rej *filestore.Rejection
		if errors.As(err, &rej) {
			s.RecordRefusal(ctx, c, id, rej.Code)
		}
		return Source{}, err
	}
	key, err := s.files.Save(s.now(), filestore.NewID(), acc.Data)
	if err != nil {
		return Source{}, err
	}
	var old *string
	var out Source
	err = s.inTx(ctx, func(tx pgx.Tx) error {
		if _, err := lockForChange(ctx, tx, c, id, version); err != nil {
			return err
		}
		if err := tx.QueryRow(ctx, `SELECT storage_key FROM catalogue.files WHERE source_id = $1`, id).Scan(&old); err != nil &&
			!errors.Is(err, pgx.ErrNoRows) {
			return err
		}
		if _, err := tx.Exec(ctx, `INSERT INTO catalogue.files (source_id, storage_key, media_type, size_bytes, content_sha256,
			uploaded_by_user_id) VALUES ($1, $2, $3, $4, $5, $6)
			ON CONFLICT (source_id) DO UPDATE SET storage_key = EXCLUDED.storage_key, media_type = EXCLUDED.media_type,
				size_bytes = EXCLUDED.size_bytes, content_sha256 = EXCLUDED.content_sha256,
				uploaded_by_user_id = EXCLUDED.uploaded_by_user_id, uploaded_at = now()`,
			id, key, acc.MediaType, len(acc.Data), acc.SHA256[:], c.UserID); err != nil {
			return err
		}
		if _, err := tx.Exec(ctx, `UPDATE catalogue.sources SET version = version + 1, updated_by_user_id = $2 WHERE id = $1`,
			id, c.UserID); err != nil {
			return err
		}
		if err := audit.Write(ctx, tx, s.event(c, "catalogue.file.stored", id, map[string]string{
			"media_type": acc.MediaType, "size_bytes": strconv.Itoa(len(acc.Data)), "scan_engine": acc.ScanEngine,
		})); err != nil {
			return err
		}
		out, err = get(ctx, tx, c.OrganizationID, id)
		return err
	})
	if err != nil {
		s.removeFile(key) // saved, but never recorded
		return Source{}, err
	}
	if old != nil {
		s.removeFile(*old)
	}
	return out, nil
}

// RecordRefusal audits a refused upload with its reason code, never the file or its name. A failed audit write is
// reported but does not change the answer: the file is refused either way.
func (s *Service) RecordRefusal(ctx context.Context, c Caller, id, code string) {
	ev := s.event(c, "catalogue.file.refused", id, map[string]string{"reason": code})
	ev.Outcome = audit.OutcomeFailure
	if err := audit.Write(ctx, s.db, ev); err != nil && s.problem != nil {
		s.problem("audit catalogue.file.refused", err)
	}
}

// OpenFile reads the stored file of a source, verified against its SHA-256.
func (s *Service) OpenFile(ctx context.Context, c Caller, id string) (StoredFile, error) {
	if s.files == nil {
		return StoredFile{}, ErrFilesUnavailable
	}
	if !uuidLike(id) {
		return StoredFile{}, ErrNotFound
	}
	var f StoredFile
	var key string
	var sum []byte
	err := s.db.QueryRow(ctx, `SELECT s.title, f.storage_key, f.media_type, f.content_sha256 FROM catalogue.sources s
		JOIN catalogue.files f ON f.source_id = s.id WHERE s.id = $1 AND s.organization_id = $2`,
		id, c.OrganizationID).Scan(&f.Title, &key, &f.MediaType, &sum)
	if errors.Is(err, pgx.ErrNoRows) {
		return StoredFile{}, ErrNotFound
	} else if err != nil {
		return StoredFile{}, err
	}
	if f.Data, err = s.files.Read(key, sum); err != nil {
		return StoredFile{}, fmt.Errorf("catalogue file %s: %w", key, err)
	}
	f.Extension = extensions[f.MediaType]
	return f, nil
}
