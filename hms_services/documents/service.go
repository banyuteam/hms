package documents

import (
	"context"
	"encoding/hex"
	"errors"
	"fmt"
	"log/slog"
	"strconv"
	"time"

	"hms/services/canonical/recordtx"
	"hms/services/integrations/legacyhms"
	"hms/services/platform/audit"
	"hms/services/platform/filestore"
)

// Store is the database side (PgStore; a fake in tests).
type Store interface {
	Categories(ctx context.Context) ([]Category, error)
	// PatientByMRN returns the canonical patient holding the active MRN, or ErrNotFound.
	PatientByMRN(ctx context.Context, organizationID, mrn string) (string, error)
	// StaffName returns the display name of a user of the organization, or ErrNotFound.
	StaffName(ctx context.Context, organizationID, userID string) (string, error)
	// Insert writes the file, the attachment and the audit event in one transaction and returns the attachment.
	Insert(ctx context.Context, tc recordtx.Context, f FileRow, a AttachmentRow, ev audit.Event) (Document, error)
	List(ctx context.Context, organizationID string, f Filter) ([]Document, error)
	Get(ctx context.Context, organizationID, id string) (Document, error)
	// MarkEnteredInError sets the status with the reason (as hms.change_reason too) and writes the audit event.
	MarkEnteredInError(ctx context.Context, tc recordtx.Context, id string, ev audit.Event) (Document, error)
	WriteAudit(ctx context.Context, ev audit.Event) error
}

// FileRow and AttachmentRow are what Insert writes.
type FileRow struct {
	ID, OrganizationID, FacilityID, MediaType, StorageKey, ScanEngine, UploadedBy string
	SizeBytes                                                                    int64
	PageCount                                                                    int
	SHA256                                                                       []byte
	ScannedAt                                                                    time.Time
}

type AttachmentRow struct {
	OrganizationID, FacilityID, FileID string
	Subject                            Subject
	PatientID                          string
	Metadata                           Metadata
	CreatedBy                          string
}

// Filter selects a list: exactly one of PatientID, VisitNumber, StaffUserID, CreatedBy.
type Filter struct {
	PatientID, VisitNumber, StaffUserID, CreatedBy string
	Before                                         string // id: older than this one
	Limit                                          int
}

// Volume and Scanner are platform/filestore (fakes in tests).
type Volume interface {
	Save(now time.Time, id string, data []byte) (string, error)
	Read(key string, sha256 []byte) ([]byte, error)
	Remove(key string) error
}

type Service struct {
	store   Store
	legacy  Legacy
	volume  Volume
	scanner filestore.Scanner
	policy  filestore.Policy
	loc     *time.Location
	logger  *slog.Logger
	now     func() time.Time
	uploads chan struct{} // bounds the memory held by uploads in progress
}

// MaxConcurrentUploads bounds memory: each upload holds up to the file limit (20 MiB) twice (read and re-encoded).
const MaxConcurrentUploads = 4

func NewService(store Store, legacy Legacy, volume Volume, scanner filestore.Scanner, maxBytes int, loc *time.Location,
	logger *slog.Logger) *Service {
	return &Service{store: store, legacy: legacy, volume: volume, scanner: scanner, policy: Policy(maxBytes), loc: loc,
		logger: logger, now: time.Now, uploads: make(chan struct{}, MaxConcurrentUploads)}
}

// MaxBytes is the per-file limit of uploads.
func (s *Service) MaxBytes() int { return s.policy.MaxBytes }

// Acquire reserves an upload slot before the body is read; the returned release must be called. ErrBusy when full.
func (s *Service) Acquire() (func(), error) {
	select {
	case s.uploads <- struct{}{}:
		return func() { <-s.uploads }, nil
	default:
		return nil, ErrBusy
	}
}

// MayUploadSomething reports whether the caller holds any upload permission (checked before the body is read).
func MayUploadSomething(c Caller) (bool, error) {
	for _, p := range []string{PermClinicalUpload, PermStaffSelf, PermStaffManage} {
		if ok, err := c.Can(p); ok || err != nil {
			return ok, err
		}
	}
	return false, nil
}

func (s *Service) Categories(ctx context.Context) ([]Category, error) {
	all, err := s.store.Categories(ctx)
	if err != nil {
		return nil, err
	}
	active := all[:0]
	for _, c := range all {
		if c.Active {
			active = append(active, c)
		}
	}
	return active, nil
}

// resolve checks the subject and returns the canonical patient of a clinical subject.
func (s *Service) resolve(ctx context.Context, c Caller, sub Subject) (patientID string, err error) {
	switch sub.Kind {
	case SubjectStaff:
		if _, err := s.store.StaffName(ctx, c.OrganizationID, sub.UserID); err != nil {
			return "", err
		}
		return "", nil
	case SubjectEncounter:
		enc, err := s.legacy.Encounter(ctx, sub.VisitNumber)
		if errors.Is(err, legacyhms.ErrNotFound) {
			return "", ErrNotFound
		}
		if err != nil {
			return "", fmt.Errorf("%w: %v", ErrLegacy, err)
		}
		if enc.MRN == nil || *enc.MRN == "" {
			return "", ErrNotFound
		}
		sub.MRN = *enc.MRN
	}
	id, err := s.store.PatientByMRN(ctx, c.OrganizationID, sub.MRN)
	if !errors.Is(err, ErrNotFound) {
		return id, err
	}
	// Not in HMS: tell "not yet copied by the legacy bridge" apart from "no such patient".
	if _, lerr := s.legacy.Patient(ctx, sub.MRN); lerr == nil {
		return "", ErrPatientNotLinked
	} else if !errors.Is(lerr, legacyhms.ErrNotFound) {
		return "", fmt.Errorf("%w: %v", ErrLegacy, lerr)
	}
	return "", ErrNotFound
}

// Upload checks, scans, stores and records one file. A refused file is a *filestore.Rejection and is audited.
func (s *Service) Upload(ctx context.Context, c Caller, sub Subject, m Metadata, file []byte) (Document, error) {
	if ok, err := canUpload(c, sub); err != nil || !ok {
		return Document{}, forbidden(err)
	}
	m, err := m.Validate(s.now().In(s.loc))
	if err != nil {
		return Document{}, err
	}
	cats, err := s.store.Categories(ctx)
	if err != nil {
		return Document{}, err
	}
	if !categoryFits(cats, m.Category, sub.Kind) {
		return Document{}, ValidationError{"category is not an active category for this kind of subject"}
	}
	patientID, err := s.resolve(ctx, c, sub)
	if err != nil {
		return Document{}, err
	}

	acc, err := filestore.Accept(ctx, s.policy, s.scanner, file)
	var rej *filestore.Rejection
	if errors.As(err, &rej) {
		ev := s.event(c, "document.upload", audit.OutcomeFailure, "")
		ev.Detail = map[string]string{"subject_kind": sub.Kind, "category": m.Category, "rejection": rej.Code,
			"size_bytes": strconv.Itoa(len(file))}
		if aerr := s.store.WriteAudit(ctx, ev); aerr != nil {
			s.logger.Error("audit of a refused upload failed", "err", aerr)
		}
		return Document{}, err
	}
	if err != nil {
		return Document{}, err
	}

	id := filestore.NewID()
	key, err := s.volume.Save(s.now(), id, acc.Data)
	if err != nil {
		return Document{}, fmt.Errorf("store file: %w", err)
	}
	f := FileRow{ID: id, OrganizationID: c.OrganizationID, FacilityID: c.FacilityID, MediaType: acc.MediaType,
		StorageKey: key, ScanEngine: acc.ScanEngine, UploadedBy: c.UserID, SizeBytes: int64(len(acc.Data)),
		PageCount: acc.PageCount, SHA256: acc.SHA256[:], ScannedAt: acc.ScannedAt}
	a := AttachmentRow{OrganizationID: c.OrganizationID, FacilityID: c.FacilityID, FileID: id, Subject: sub,
		PatientID: patientID, Metadata: m, CreatedBy: c.UserID}
	ev := s.event(c, "document.upload", audit.OutcomeSuccess, "")
	ev.Detail = map[string]string{"subject_kind": sub.Kind, "category": m.Category, "media_type": acc.MediaType,
		"size_bytes": strconv.Itoa(len(acc.Data)), "sha256": hex.EncodeToString(acc.SHA256[:])}
	tc := recordtx.Context{OrganizationID: c.OrganizationID, Actor: recordtx.User(c.UserID), RequestID: c.RequestID}
	doc, err := s.store.Insert(ctx, tc, f, a, ev)
	if err != nil {
		if rerr := s.volume.Remove(key); rerr != nil {
			s.logger.Error("orphaned upload left on the file volume", "storage_key", key, "err", rerr)
		}
		if errors.Is(err, recordtx.ErrInvalid) {
			return Document{}, ValidationError{"the attachment was refused by a record rule"}
		}
		return Document{}, err
	}
	return doc, nil
}

func categoryFits(cats []Category, code, kind string) bool {
	scope := "clinical"
	if kind == SubjectStaff {
		scope = "staff"
	}
	for _, c := range cats {
		if c.Code == code {
			return c.Active && c.Scope == scope
		}
	}
	return false
}

// ListQuery is one list request: a subject, or Mine for the caller's own uploads.
type ListQuery struct {
	Subject Subject
	Mine    bool
	Before  string
	Limit   int
}

// List returns attachments newest first: of a patient (with its encounters' files), of one encounter, of a staff
// member, or the caller's own uploads (only those the caller may still see). Audited.
func (s *Service) List(ctx context.Context, c Caller, q ListQuery) ([]Document, error) {
	if q.Before != "" && !uuidPattern.MatchString(q.Before) {
		return nil, ValidationError{"before must be an attachment id"}
	}
	if q.Limit <= 0 || q.Limit > 200 {
		q.Limit = 50
	}
	f := Filter{Before: q.Before, Limit: q.Limit}
	resource, resourceID := "DocumentReference", ""
	switch {
	case q.Mine:
		f.CreatedBy, resource, resourceID = c.UserID, "Practitioner", c.UserID
	case clinical(q.Subject.Kind):
		if ok, err := c.Can(PermClinicalRead); err != nil || !ok {
			return nil, forbidden(err)
		}
		if q.Subject.Kind == SubjectEncounter {
			f.VisitNumber, resource, resourceID = q.Subject.VisitNumber, "Encounter", q.Subject.VisitNumber
			break
		}
		id, err := s.store.PatientByMRN(ctx, c.OrganizationID, q.Subject.MRN)
		if errors.Is(err, ErrNotFound) {
			return []Document{}, nil // not in HMS yet, so nothing can be attached to it
		}
		if err != nil {
			return nil, err
		}
		f.PatientID, resource, resourceID = id, "Patient", id
	default:
		if ok, err := canUpload(c, q.Subject); err != nil || !ok {
			return nil, forbidden(err)
		}
		f.StaffUserID, resource, resourceID = q.Subject.UserID, "Practitioner", q.Subject.UserID
	}
	docs, err := s.store.List(ctx, c.OrganizationID, f)
	if err != nil {
		return nil, err
	}
	if q.Mine {
		visible := docs[:0]
		for _, d := range docs {
			ok, err := canRead(c, d)
			if err != nil {
				return nil, err
			}
			if ok {
				visible = append(visible, d)
			}
		}
		docs = visible
	}
	ev := s.event(c, "document.list", audit.OutcomeSuccess, resourceID)
	ev.ResourceType = resource
	ev.Detail = map[string]string{"count": strconv.Itoa(len(docs))}
	if err := s.store.WriteAudit(ctx, ev); err != nil {
		return nil, fmt.Errorf("audit: %w", err)
	}
	return docs, nil
}

// Get returns one attachment's metadata. Audited.
func (s *Service) Get(ctx context.Context, c Caller, id string) (Document, error) {
	d, err := s.readable(ctx, c, id)
	if err != nil {
		return Document{}, err
	}
	if err := s.store.WriteAudit(ctx, s.event(c, "document.read", audit.OutcomeSuccess, id)); err != nil {
		return Document{}, fmt.Errorf("audit: %w", err)
	}
	return d, nil
}

// Content returns the stored bytes after the hash check. An entered-in-error attachment is not served. Audited.
func (s *Service) Content(ctx context.Context, c Caller, id string) (Document, []byte, error) {
	d, err := s.readable(ctx, c, id)
	if err != nil {
		return Document{}, nil, err
	}
	if d.Status == StatusEnteredInError {
		return Document{}, nil, ErrEnteredInError
	}
	data, err := s.volume.Read(d.StorageKey, d.SHA256)
	if err != nil {
		// A missing or altered file is an integrity incident, never shown as "not found".
		s.logger.Error("stored document failed its integrity check", "document_id", id, "err", err)
		return Document{}, nil, fmt.Errorf("read file: %w", err)
	}
	if err := s.store.WriteAudit(ctx, s.event(c, "document.content.read", audit.OutcomeSuccess, id)); err != nil {
		return Document{}, nil, fmt.Errorf("audit: %w", err)
	}
	return d, data, nil
}

// MarkEnteredInError retires an attachment that should not be in the record (wrong patient, wrong file). The file is
// kept; the attachment stays listed with its status and reason.
func (s *Service) MarkEnteredInError(ctx context.Context, c Caller, id, reason string) (Document, error) {
	reason = spaces.ReplaceAllString(reason, " ")
	if n := len([]rune(reason)); n < 3 || n > 500 {
		return Document{}, ValidationError{"reason is required (3 to 500 characters)"}
	}
	d, err := s.store.Get(ctx, c.OrganizationID, id)
	if err != nil {
		return Document{}, err
	}
	if ok, err := canMarkError(c, d); err != nil || !ok {
		return Document{}, forbidden(err)
	}
	if d.Status == StatusEnteredInError {
		return Document{}, ErrEnteredInError
	}
	tc := recordtx.Context{OrganizationID: c.OrganizationID, Actor: recordtx.User(c.UserID), RequestID: c.RequestID,
		ChangeReason: reason}
	return s.store.MarkEnteredInError(ctx, tc, id, s.event(c, "document.entered_in_error", audit.OutcomeSuccess, id))
}

func (s *Service) readable(ctx context.Context, c Caller, id string) (Document, error) {
	if !uuidPattern.MatchString(id) {
		return Document{}, ErrNotFound
	}
	d, err := s.store.Get(ctx, c.OrganizationID, id)
	if err != nil {
		return Document{}, err
	}
	if ok, err := canRead(c, d); err != nil || !ok {
		return Document{}, forbidden(err)
	}
	return d, nil
}

func forbidden(err error) error {
	if err != nil {
		return err
	}
	return ErrForbidden
}

func (s *Service) event(c Caller, action, outcome, id string) audit.Event {
	return audit.Event{OccurredAt: s.now(), Category: audit.CategoryDataAccess, Action: action, Outcome: outcome,
		ActorType: audit.ActorUser, ActorID: c.UserID, OrganizationID: c.OrganizationID, FacilityID: c.FacilityID,
		ResourceType: "DocumentReference", ResourceID: id, Channel: c.Channel, RequestID: c.RequestID,
		ClientAddr: c.ClientAddr}
}
