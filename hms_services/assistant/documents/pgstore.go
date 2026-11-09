package documents

import (
	"context"
	"errors"
	"fmt"
	"strconv"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"hms/services/platform/audit"
)

// Doc is the metadata of one checked, stored file (assistant.documents, hms_database migration 0007). No file name.
type Doc struct {
	ID, OrganizationID, FacilityID, UserID, VisitNumber string
	UploadedType, StoredType                            string
	Size                                                int64
	Pages                                               *int
	SHA256                                              []byte
	StorageKey, ScanEngine                              string
	Retention                                           time.Duration
}

// PgStore keeps document metadata as hms_meta_runtime through hms_assistant_rw.
type PgStore struct{ db *pgxpool.Pool }

func NewPgStore(db *pgxpool.Pool) *PgStore { return &PgStore{db: db} }

// Insert records the document and its audit event in one transaction and returns when the file expires. expires_at is
// computed by the database from its own clock, so it can never exceed the 30-day limit through clock skew.
func (s *PgStore) Insert(ctx context.Context, d Doc, ev audit.Event) (time.Time, error) {
	var expires time.Time
	err := pgx.BeginTxFunc(ctx, s.db, pgx.TxOptions{IsoLevel: pgx.ReadCommitted}, func(tx pgx.Tx) error {
		if err := tx.QueryRow(ctx, `
INSERT INTO assistant.documents (id, organization_id, facility_id, user_id, visit_number, uploaded_media_type,
                                 stored_media_type, size_bytes, page_count, sha256, storage_key, scan_engine, expires_at)
VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5, $6, $7, $8, $9, $10, $11, $12, now() + make_interval(secs => $13))
RETURNING expires_at`, d.ID, d.OrganizationID, d.FacilityID, d.UserID, d.VisitNumber, d.UploadedType, d.StoredType,
			d.Size, d.Pages, d.SHA256, d.StorageKey, d.ScanEngine, d.Retention.Seconds()).Scan(&expires); err != nil {
			return fmt.Errorf("insert document: %w", err)
		}
		return audit.Write(ctx, tx, ev)
	})
	return expires, err
}

// Owned returns the storage key of a document the user uploaded and that is still on the volume.
func (s *PgStore) Owned(ctx context.Context, id, userID string) (string, bool, error) {
	var key string
	err := s.db.QueryRow(ctx, `SELECT storage_key FROM assistant.documents
WHERE id = $1::uuid AND user_id = $2::uuid AND purged_at IS NULL`, id, userID).Scan(&key)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", false, nil
	}
	return key, err == nil, err
}

// MarkPurged records that the file was deleted from the volume, with its audit event.
func (s *PgStore) MarkPurged(ctx context.Context, id string, ev audit.Event) error {
	return pgx.BeginTxFunc(ctx, s.db, pgx.TxOptions{IsoLevel: pgx.ReadCommitted}, func(tx pgx.Tx) error {
		if _, err := tx.Exec(ctx, `UPDATE assistant.documents SET purged_at = now()
WHERE id = $1::uuid AND purged_at IS NULL`, id); err != nil {
			return err
		}
		return audit.Write(ctx, tx, ev)
	})
}

// Remover deletes a stored file by key (Volume).
type Remover interface {
	Remove(key string) error
}

const (
	purgeFiles      = 100  // files per batch
	purgeRows       = 1000 // rows per batch
	purgeMaxBatches = 100
)

// Purge deletes expired files from the volume (and marks them purged), then, after twelve months, the readings and the
// document metadata. It returns the counts per step and records a non-empty run as one system audit event.
func (s *PgStore) Purge(ctx context.Context, now time.Time, vol Remover) (map[string]int64, error) {
	res := map[string]int64{}
	for n := 0; n < purgeMaxBatches; n++ {
		rows, err := s.db.Query(ctx, `SELECT id::text, storage_key FROM assistant.documents
WHERE purged_at IS NULL AND expires_at <= $1 ORDER BY expires_at LIMIT $2`, now, purgeFiles)
		if err != nil {
			return res, err
		}
		type due struct{ id, key string }
		var batch []due
		for rows.Next() {
			var d due
			if err := rows.Scan(&d.id, &d.key); err != nil {
				rows.Close()
				return res, err
			}
			batch = append(batch, d)
		}
		rows.Close()
		if err := rows.Err(); err != nil {
			return res, err
		}
		for _, d := range batch {
			// The file goes first: a failure leaves the row unpurged, and the next run tries again.
			if err := vol.Remove(d.key); err != nil {
				return res, fmt.Errorf("remove expired document: %w", err)
			}
			if _, err := s.db.Exec(ctx, `UPDATE assistant.documents SET purged_at = now()
WHERE id = $1::uuid AND purged_at IS NULL`, d.id); err != nil {
				return res, err
			}
			res["files"]++
		}
		if len(batch) < purgeFiles {
			break
		}
	}

	year := now.AddDate(-1, 0, 0)
	for _, st := range []struct{ name, sql string }{
		{"document_readings", `DELETE FROM assistant.document_readings WHERE id IN (
SELECT id FROM assistant.document_readings WHERE created_at < $1 LIMIT $2)`},
		{"documents", `DELETE FROM assistant.documents WHERE id IN (
SELECT d.id FROM assistant.documents d
WHERE d.created_at < $1 AND d.purged_at IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM assistant.document_reading_files f WHERE f.document_id = d.id)
LIMIT $2)`},
	} {
		for n := 0; n < purgeMaxBatches; n++ {
			tag, err := s.db.Exec(ctx, st.sql, year, purgeRows)
			if err != nil {
				return res, fmt.Errorf("purge %s: %w", st.name, err)
			}
			res[st.name] += tag.RowsAffected()
			if tag.RowsAffected() < purgeRows {
				break
			}
		}
	}

	total := int64(0)
	detail := map[string]string{}
	for k, v := range res {
		total += v
		detail[k] = strconv.FormatInt(v, 10)
	}
	if total > 0 {
		if err := audit.Write(ctx, s.db, audit.Event{OccurredAt: now, Category: audit.CategoryAdministration,
			Action: "assistant.documents.purge", Outcome: audit.OutcomeSuccess, ActorType: audit.ActorSystem,
			Channel: "system", Detail: detail}); err != nil {
			return res, err
		}
	}
	return res, nil
}
