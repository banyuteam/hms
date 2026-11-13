// Package documents attaches files from outside HMS (scanned letters, results from other facilities, certificates) to
// a patient, to one of the patient's encounters, or to a staff member, to complete the record (ADR-SVC-013, contract
// documents-v1, hms_database migration 0023). Every file passes platform/filestore (type from content, PDF and image
// checks, ClamAV) before it is stored; the uploader is recorded as the work reference of every attachment. Encounters
// are still read from the legacy HMS, so an encounter file carries the Khanza visit number, checked at upload. Every
// upload, list, read and status change is audited; nothing is returned when the audit event cannot be written.
package documents

import (
	"context"
	"errors"
	"regexp"
	"strings"
	"time"
	"unicode/utf8"

	"hms/services/integrations/legacyhms"
	"hms/services/platform/filestore"
)

// Subjects a file can be attached to.
const (
	SubjectPatient   = "patient"
	SubjectEncounter = "encounter"
	SubjectStaff     = "staff"
)

// Permissions (registered in iam.permissions at start-up; no role holds them until an administrator grants them).
const (
	PermClinicalUpload = "document.clinical.upload"
	PermClinicalRead   = "document.clinical.read"
	PermClinicalManage = "document.clinical.manage"
	PermStaffSelf      = "document.staff.self"
	PermStaffManage    = "document.staff.manage"
)

// Statuses (document.attachments.status).
const (
	StatusCurrent        = "current"
	StatusEnteredInError = "entered-in-error"
)

// Policy is what a patient, encounter or staff file may be: PDF up to 200 pages, JPEG or PNG.
func Policy(maxBytes int) filestore.Policy {
	return filestore.Policy{Allowed: []string{filestore.TypePDF, filestore.TypeJPEG, filestore.TypePNG},
		MaxBytes: maxBytes, MaxPDFPages: 200}
}

// Caller is the signed-in person with the request's audit context. Can asks IAM whether they hold a permission at the
// session's facility (a denial is audited by IAM).
type Caller struct {
	UserID         string
	OrganizationID string
	FacilityID     string
	RequestID      string
	ClientAddr     string
	Channel        string
	Can            func(permission string) (bool, error)
}

// Category is what a file is (document.categories).
type Category struct {
	Code   string `json:"code"`
	Scope  string `json:"scope"` // clinical | staff
	Name   string `json:"name"`
	Active bool   `json:"-"`
}

// Subject is what a file is attached to: the patient (MRN, resolved to the canonical patient), an encounter (legacy
// visit number, with its patient) or a staff member (iam user).
type Subject struct {
	Kind        string
	MRN         string
	VisitNumber string
	UserID      string
}

// Metadata is the descriptive part of an upload.
type Metadata struct {
	Category           string
	Title              string
	Description        string
	DocumentDate       string // YYYY-MM-DD written on the document; "" = not given
	SourceOrganization string
}

// Document is a stored attachment.
type Document struct {
	ID                 string
	Status             string
	StatusReason       string
	Category           Category
	Title              string
	Description        string
	DocumentDate       string
	SourceOrganization string
	Subject            Subject
	PatientID          string
	StaffName          string
	MediaType          string
	SizeBytes          int64
	PageCount          int
	SHA256             []byte
	StorageKey         string
	CreatedBy          string
	CreatedByName      string
	CreatedAt          time.Time
	UpdatedAt          time.Time
	Version            int
}

// ValidationError is a request the rules refuse; Msg is safe to show.
type ValidationError struct{ Msg string }

func (e ValidationError) Error() string { return e.Msg }

var (
	ErrForbidden        = errors.New("documents: not permitted")
	ErrNotFound         = errors.New("documents: not found")
	ErrPatientNotLinked = errors.New("documents: patient is in the legacy HMS but not yet in HMS")
	ErrBusy             = errors.New("documents: too many uploads in progress")
	ErrEnteredInError   = errors.New("documents: attachment is entered-in-error")
	ErrLegacy           = errors.New("documents: legacy HMS unavailable")
)

var (
	mrnPattern   = regexp.MustCompile(`^[A-Za-z0-9.-]{1,15}$`)
	visitPattern = regexp.MustCompile(`^[0-9/]{1,17}$`)
	uuidPattern  = regexp.MustCompile(`^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$`)
	spaces       = regexp.MustCompile(`\s+`)
)

// ParseSubject validates the subject fields of a request.
func ParseSubject(kind, mrn, visit, userID string) (Subject, error) {
	s := Subject{Kind: kind, MRN: strings.TrimSpace(mrn), VisitNumber: strings.TrimSpace(visit), UserID: strings.TrimSpace(userID)}
	switch kind {
	case SubjectPatient:
		if !mrnPattern.MatchString(s.MRN) || s.VisitNumber != "" || s.UserID != "" {
			return Subject{}, ValidationError{"a patient file needs mrn (and no visit_number or user_id)"}
		}
	case SubjectEncounter:
		if !visitPattern.MatchString(s.VisitNumber) || s.MRN != "" || s.UserID != "" {
			return Subject{}, ValidationError{"an encounter file needs visit_number (and no mrn or user_id)"}
		}
	case SubjectStaff:
		if !uuidPattern.MatchString(s.UserID) || s.MRN != "" || s.VisitNumber != "" {
			return Subject{}, ValidationError{"a staff file needs user_id (and no mrn or visit_number)"}
		}
	default:
		return Subject{}, ValidationError{"subject_kind must be patient, encounter or staff"}
	}
	return s, nil
}

// Validate normalizes the metadata; today is the facility's current date.
func (m Metadata) Validate(today time.Time) (Metadata, error) {
	m.Category = strings.TrimSpace(m.Category)
	m.Title = strings.TrimSpace(spaces.ReplaceAllString(m.Title, " "))
	m.Description = strings.TrimSpace(m.Description)
	m.SourceOrganization = strings.TrimSpace(spaces.ReplaceAllString(m.SourceOrganization, " "))
	m.DocumentDate = strings.TrimSpace(m.DocumentDate)
	if m.Category == "" {
		return Metadata{}, ValidationError{"category is required"}
	}
	if n := utf8.RuneCountInString(m.Title); n < 1 || n > 200 {
		return Metadata{}, ValidationError{"title is required (at most 200 characters)"}
	}
	if utf8.RuneCountInString(m.Description) > 2000 {
		return Metadata{}, ValidationError{"description is at most 2000 characters"}
	}
	if utf8.RuneCountInString(m.SourceOrganization) > 200 {
		return Metadata{}, ValidationError{"source_organization is at most 200 characters"}
	}
	if m.DocumentDate != "" {
		d, err := time.Parse("2006-01-02", m.DocumentDate)
		y, mo, da := today.Date()
		if err != nil || d.Year() < 1900 || d.After(time.Date(y, mo, da, 0, 0, 0, 0, time.UTC)) {
			return Metadata{}, ValidationError{"document_date must be a real date (YYYY-MM-DD), not in the future"}
		}
	}
	return m, nil
}

// clinical reports whether a subject kind is part of the patient record.
func clinical(kind string) bool { return kind == SubjectPatient || kind == SubjectEncounter }

// canUpload: clinical files need document.clinical.upload; staff files document.staff.manage, or document.staff.self
// for one's own.
func canUpload(c Caller, s Subject) (bool, error) {
	if clinical(s.Kind) {
		return c.Can(PermClinicalUpload)
	}
	if s.UserID == c.UserID {
		if ok, err := c.Can(PermStaffSelf); ok || err != nil {
			return ok, err
		}
	}
	return c.Can(PermStaffManage)
}

// canRead: clinical files need document.clinical.read, except that an uploader still holding
// document.clinical.upload may open their own uploads (their work reference); staff files are open to the staff
// member (document.staff.self) and to document.staff.manage.
func canRead(c Caller, d Document) (bool, error) {
	if clinical(d.Subject.Kind) {
		if ok, err := c.Can(PermClinicalRead); ok || err != nil {
			return ok, err
		}
		if d.CreatedBy == c.UserID {
			return c.Can(PermClinicalUpload)
		}
		return false, nil
	}
	return canUpload(c, d.Subject)
}

// canMarkError: the uploader (still allowed to upload that subject) or the manage permission of its scope.
func canMarkError(c Caller, d Document) (bool, error) {
	if d.CreatedBy == c.UserID {
		if ok, err := canUpload(c, d.Subject); ok || err != nil {
			return ok, err
		}
	}
	if clinical(d.Subject.Kind) {
		return c.Can(PermClinicalManage)
	}
	return c.Can(PermStaffManage)
}

// Legacy is the read-only legacy HMS: the encounter of a visit number and whether an MRN exists there.
type Legacy interface {
	Encounter(ctx context.Context, number string) (legacyhms.EncounterRow, error)
	Patient(ctx context.Context, mrn string) (legacyhms.PatientRow, error)
}
