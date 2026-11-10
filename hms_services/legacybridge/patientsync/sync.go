package patientsync

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"hms/services/canonical/patient"
	"hms/services/canonical/recordtx"
	"hms/services/integrations/legacyhms"
)

// Change detection (standards/security/legacy-read-only-policy.md): `pasien` has no reliable update timestamp, so the
// bridge scans it in primary-key order, one bounded batch at a time, and compares each row's hash with the one stored
// on its crosswalk link. A full pass then starts again from the first key. A pass sees rows as they are when read: it
// cannot see intermediate states, and the time it observes a change is not the time the change was made. Rows deleted
// from the legacy HMS are not detected (no tombstones); reconciliation of deletions is a later step.

// Source reads the legacy patient table (legacyhms.Clinical).
type Source interface {
	PatientScan(ctx context.Context, after string, limit int) ([]legacyhms.PatientRow, error)
}

type Options struct {
	OrganizationID   string
	OrganizationCode string
	Batch            int           // rows per batch (1..5000)
	LeaseTTL         time.Duration // how long a batch may hold the stream
	Holder           string        // this instance; "" = random
	Logger           *slog.Logger
	Now              func() time.Time
}

// Outcome of one legacy row.
type Outcome int

const (
	Unchanged  Outcome = iota // same mapped content as last time: nothing written
	Created                   // new canonical patient and crosswalk link
	Updated                   // canonical patient changed to match the legacy row
	Rejected                  // not written; bridge issue raised
	NotApplied                // the domain is no longer legacy: change not applied, bridge issue raised
)

type Stats struct {
	Observed, Created, Updated, Unchanged, Rejected, NotApplied int
	// CycleComplete: the batch reached the end of the table; the next batch starts a new pass.
	CycleComplete bool
}

var (
	ErrLeaseHeld = errors.New("another bridge instance holds the stream")
	ErrLeaseLost = errors.New("the stream lease was lost before the checkpoint could advance")
)

const (
	sourceSystem = "legacy-hms"
	sourceEntity = "pasien"
)

type Worker struct {
	db     *pgxpool.Pool
	src    Source
	opt    Options
	stream string
}

func New(db *pgxpool.Pool, src Source, opt Options) (*Worker, error) {
	if opt.Batch < 1 || opt.Batch > 5000 {
		return nil, fmt.Errorf("patientsync: batch %d outside 1..5000", opt.Batch)
	}
	if opt.LeaseTTL <= 0 {
		opt.LeaseTTL = 5 * time.Minute
	}
	if opt.Holder == "" {
		b := make([]byte, 8)
		_, _ = rand.Read(b)
		opt.Holder = "legacy-bridge-" + hex.EncodeToString(b)
	}
	if opt.Logger == nil {
		opt.Logger = slog.Default()
	}
	if opt.Now == nil {
		opt.Now = time.Now
	}
	code := strings.ToLower(opt.OrganizationCode)
	stream := sourceSystem + "." + code + "." + sourceEntity
	if code == "" || len(stream) > 100 || strings.ContainsAny(code, " /") {
		return nil, fmt.Errorf("patientsync: organization code %q cannot name a stream", opt.OrganizationCode)
	}
	return &Worker{db: db, src: src, opt: opt, stream: stream}, nil
}

// Stream is the polling stream name (integration.poll_checkpoints.stream_name).
func (w *Worker) Stream() string { return w.stream }

// RunBatch maps one batch of legacy rows and advances the checkpoint. A row the mapping or the record rules refuse is
// recorded as a bridge issue and does not stop the batch; any other failure leaves the checkpoint where it was, so
// the batch is read again next time (writes are idempotent by row hash).
func (w *Worker) RunBatch(ctx context.Context) (Stats, error) {
	var st Stats
	fence, err := w.acquire(ctx)
	if err != nil {
		return st, err
	}
	cursor, version, err := w.checkpoint(ctx)
	if err != nil {
		return st, err
	}
	var runID string
	if err := w.db.QueryRow(ctx, `INSERT INTO integration.sync_runs (stream_name, lease_fence) VALUES ($1, $2) RETURNING run_id::text`,
		w.stream, fence).Scan(&runID); err != nil {
		return st, fmt.Errorf("start sync run: %w", err)
	}

	rows, err := w.src.PatientScan(ctx, cursor, w.opt.Batch)
	if err != nil {
		w.fail(ctx, runID, "source_unavailable")
		return st, fmt.Errorf("read legacy patients: %w", err)
	}
	for _, row := range rows {
		o, err := w.apply(ctx, runID, row)
		if err != nil {
			w.fail(ctx, runID, "apply_failed")
			return st, err
		}
		st.Observed++
		switch o {
		case Created:
			st.Created++
		case Updated:
			st.Updated++
		case Unchanged:
			st.Unchanged++
		case Rejected:
			st.Rejected++
		case NotApplied:
			st.NotApplied++
		}
	}

	var next any // NULL = start the next pass from the first key
	if len(rows) == w.opt.Batch && rows[len(rows)-1].MRN != nil {
		next = []string{*rows[len(rows)-1].MRN}
	} else {
		st.CycleComplete = true
	}
	tag, err := w.db.Exec(ctx, `UPDATE integration.poll_checkpoints
SET cursor_value = $3::jsonb, cursor_version = cursor_version + 1, last_batch_count = $4, last_success_at = now(),
    last_error_at = NULL, last_error_code = NULL
WHERE stream_name = $1 AND cursor_version = $2
  AND EXISTS (SELECT 1 FROM integration.poll_leases l
              WHERE l.stream_name = $1 AND l.holder = $5 AND l.fence = $6 AND l.expires_at > now())`,
		w.stream, version, jsonOrNil(next), len(rows), w.opt.Holder, fence)
	if err != nil {
		w.fail(ctx, runID, "checkpoint_failed")
		return st, fmt.Errorf("advance checkpoint: %w", err)
	}
	if tag.RowsAffected() == 0 {
		w.finish(ctx, runID, "abandoned", st.Observed, "lease_lost")
		return st, ErrLeaseLost
	}
	w.finish(ctx, runID, "succeeded", st.Observed, "")
	return st, nil
}

func jsonOrNil(v any) any {
	if v == nil {
		return nil
	}
	b, _ := json.Marshal(v)
	return string(b)
}

func (w *Worker) acquire(ctx context.Context) (int64, error) {
	var fence int64
	err := w.db.QueryRow(ctx, `INSERT INTO integration.poll_leases (stream_name, holder, fence, expires_at)
VALUES ($1, $2, 1, now() + $3::interval)
ON CONFLICT (stream_name) DO UPDATE
SET holder = EXCLUDED.holder, fence = poll_leases.fence + 1, acquired_at = now(), expires_at = EXCLUDED.expires_at
WHERE poll_leases.expires_at < now() OR poll_leases.holder = EXCLUDED.holder
RETURNING fence`, w.stream, w.opt.Holder, fmt.Sprintf("%d seconds", int(w.opt.LeaseTTL.Seconds()))).Scan(&fence)
	if errors.Is(err, pgx.ErrNoRows) {
		return 0, ErrLeaseHeld
	}
	if err != nil {
		return 0, fmt.Errorf("acquire stream lease: %w", err)
	}
	return fence, nil
}

func (w *Worker) checkpoint(ctx context.Context) (cursor string, version int64, err error) {
	if _, err := w.db.Exec(ctx, `INSERT INTO integration.poll_checkpoints (stream_name, source_system) VALUES ($1, $2)
ON CONFLICT (stream_name) DO NOTHING`, w.stream, sourceSystem); err != nil {
		return "", 0, fmt.Errorf("create checkpoint: %w", err)
	}
	var raw []byte
	if err := w.db.QueryRow(ctx, `SELECT cursor_value, cursor_version FROM integration.poll_checkpoints WHERE stream_name = $1`,
		w.stream).Scan(&raw, &version); err != nil {
		return "", 0, fmt.Errorf("read checkpoint: %w", err)
	}
	if raw != nil {
		var c []string
		if err := json.Unmarshal(raw, &c); err != nil || len(c) != 1 {
			return "", 0, errors.New("checkpoint cursor is not a one-key array")
		}
		cursor = c[0]
	}
	return cursor, version, nil
}

func (w *Worker) fail(ctx context.Context, runID, code string) {
	w.finish(ctx, runID, "failed", 0, code)
	_, _ = w.db.Exec(ctx, `UPDATE integration.poll_checkpoints SET last_error_at = now(), last_error_code = $2 WHERE stream_name = $1`,
		w.stream, code)
}

func (w *Worker) finish(ctx context.Context, runID, status string, observed int, code string) {
	if _, err := w.db.Exec(ctx, `UPDATE integration.sync_runs SET status = $2, finished_at = now(), rows_observed = $3,
       error_code = NULLIF($4, '') WHERE run_id = $1::uuid`, runID, status, observed, code); err != nil {
		w.opt.Logger.Warn("sync run not closed", "stream", w.stream, "err", err)
	}
}

// apply maps and writes one row. A NIK already used by another patient is dropped and reported (duplicate NIKs are
// common in legacy data); any other refusal by a record rule rejects the row. Only unexpected failures return an error.
func (w *Worker) apply(ctx context.Context, runID string, row legacyhms.PatientRow) (Outcome, error) {
	m := Map(row, w.opt.Now())
	if m.Key == "" {
		m.Key = "(empty)"
	}
	o, err := w.write(ctx, runID, m)
	if errors.Is(err, recordtx.ErrConflict) && m.HasNIK() {
		m = m.WithoutNIK("duplicate_nik")
		o, err = w.write(ctx, runID, m)
	}
	if errors.Is(err, recordtx.ErrConflict) || errors.Is(err, recordtx.ErrInvalid) {
		reason := "record_rule"
		if errors.Is(err, recordtx.ErrConflict) {
			reason = "identifier_conflict"
		}
		w.opt.Logger.Warn("legacy patient rejected by a record rule", "stream", w.stream, "reason", reason,
			"constraint", recordtx.Constraint(err))
		err = recordtx.Write(ctx, w.db, w.context(runID), func(tx pgx.Tx) error {
			return w.raise(ctx, tx, m, Issue{Kind: "rejected", Reason: reason})
		})
		return Rejected, err
	}
	return o, err
}

func (w *Worker) context(runID string) recordtx.Context {
	return recordtx.Context{OrganizationID: w.opt.OrganizationID, Actor: recordtx.Service(recordtx.BridgeService), RequestID: runID}
}

func (w *Worker) write(ctx context.Context, runID string, m Mapped) (Outcome, error) {
	var o Outcome
	err := recordtx.Write(ctx, w.db, w.context(runID), func(tx pgx.Tx) error {
		var linkID, patientID string
		var hash []byte
		err := tx.QueryRow(ctx, `SELECT id::text, resource_id::text, source_row_sha256 FROM integration.legacy_record_links
WHERE source_system = $1 AND source_entity = $2 AND source_key = $3 AND resource_type = 'Patient' AND status = 'linked'`,
			sourceSystem, sourceEntity, m.Key).Scan(&linkID, &patientID, &hash)
		found := err == nil
		if err != nil && !errors.Is(err, pgx.ErrNoRows) {
			return err
		}
		if found && string(hash) == string(m.Hash[:]) {
			o = Unchanged
			return nil
		}

		authority, err := recordtx.DomainAuthority(ctx, tx, patient.Domain)
		if err != nil {
			return err
		}
		if authority != recordtx.AuthorityLegacy {
			// HMS owns the domain now (or is cutting over): a legacy change is reported, never applied.
			o = NotApplied
			reason := "changed_after_cutover"
			if !found {
				reason = "new_after_cutover"
			}
			return w.raise(ctx, tx, m, Issue{Kind: "not_applied", Reason: reason})
		}

		if m.Rejected {
			o = Rejected
			for _, is := range m.Issues {
				if err := w.raise(ctx, tx, m, is); err != nil {
					return err
				}
			}
			return w.resolve(ctx, tx, m)
		}
		if found {
			if _, err := patient.Replace(ctx, tx, w.opt.OrganizationID, patientID, m.Patient); err != nil {
				return err
			}
			if _, err := tx.Exec(ctx, `UPDATE integration.legacy_record_links
SET source_row_sha256 = $2, mapping_version = $3, last_observed_at = now() WHERE id = $1::uuid`, linkID, m.Hash[:], MappingVersion); err != nil {
				return err
			}
			o = Updated
		} else {
			id, err := patient.Create(ctx, tx, w.opt.OrganizationID, "", m.Patient)
			if err != nil {
				return err
			}
			if _, err := tx.Exec(ctx, `INSERT INTO integration.legacy_record_links
(organization_id, source_system, source_entity, source_key, resource_type, resource_id, source_row_sha256, mapping_version)
VALUES ($1::uuid, $2, $3, $4, 'Patient', $5::uuid, $6, $7)`,
				w.opt.OrganizationID, sourceSystem, sourceEntity, m.Key, id, m.Hash[:], MappingVersion); err != nil {
				return err
			}
			o = Created
		}
		for _, is := range m.Issues {
			if err := w.raise(ctx, tx, m, is); err != nil {
				return err
			}
		}
		return w.resolve(ctx, tx, m)
	})
	return o, err
}

// raise records an issue, or counts it again while it is still open.
func (w *Worker) raise(ctx context.Context, tx pgx.Tx, m Mapped, is Issue) error {
	_, err := tx.Exec(ctx, `INSERT INTO integration.bridge_issues AS i
(organization_id, source_system, source_entity, source_key, source_field, kind, reason_code, mapping_version, source_row_sha256)
VALUES ($1::uuid, $2, $3, $4, $5, $6, $7, $8, $9)
ON CONFLICT (organization_id, source_system, source_entity, source_key, reason_code, source_field) WHERE status = 'open'
DO UPDATE SET last_seen_at = now(), seen_count = i.seen_count + 1, source_row_sha256 = EXCLUDED.source_row_sha256,
              mapping_version = EXCLUDED.mapping_version`,
		w.opt.OrganizationID, sourceSystem, sourceEntity, truncate(m.Key, 200), is.Field, is.Kind, is.Reason, MappingVersion, m.Hash[:])
	if err != nil {
		return fmt.Errorf("raise bridge issue %s: %w", is.Reason, err)
	}
	return nil
}

// resolve closes the row's open mapping issues that the current mapping no longer reports.
func (w *Worker) resolve(ctx context.Context, tx pgx.Tx, m Mapped) error {
	reasons, fields := []string{}, []string{}
	for _, is := range m.Issues {
		reasons, fields = append(reasons, is.Reason), append(fields, is.Field)
	}
	_, err := tx.Exec(ctx, `UPDATE integration.bridge_issues SET status = 'resolved', closed_at = now()
WHERE source_system = $1 AND source_entity = $2 AND source_key = $3 AND status = 'open' AND kind IN ('rejected', 'partial')
  AND (reason_code, source_field) NOT IN (SELECT r, f FROM unnest($4::text[], $5::text[]) AS x(r, f))`,
		sourceSystem, sourceEntity, truncate(m.Key, 200), reasons, fields)
	if err != nil {
		return fmt.Errorf("resolve bridge issues: %w", err)
	}
	return nil
}

func truncate(s string, n int) string {
	if r := []rune(s); len(r) > n {
		return string(r[:n])
	}
	return s
}

// Run maps batches back to back with a pause between them until a pass completes, then waits interval before the
// next pass. It returns when ctx ends; a failed batch is logged and retried after interval.
func (w *Worker) Run(ctx context.Context, pause, interval time.Duration) error {
	for {
		st, err := w.RunBatch(ctx)
		wait := pause
		switch {
		case ctx.Err() != nil:
			return nil
		case errors.Is(err, ErrLeaseHeld):
			w.opt.Logger.Info("stream held by another instance", "stream", w.stream)
			wait = interval
		case err != nil:
			w.opt.Logger.Error("bridge batch failed", "stream", w.stream, "err", err)
			wait = interval
		default:
			w.opt.Logger.Info("bridge batch", "stream", w.stream, "observed", st.Observed, "created", st.Created,
				"updated", st.Updated, "unchanged", st.Unchanged, "rejected", st.Rejected, "not_applied", st.NotApplied,
				"pass_complete", st.CycleComplete)
			if st.CycleComplete {
				wait = interval
			}
		}
		select {
		case <-ctx.Done():
			return nil
		case <-time.After(wait):
		}
	}
}
