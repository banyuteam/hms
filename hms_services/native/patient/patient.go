// Package patient is the native transaction layer for patients (ADR-ROOT-002, ADR-SVC-010): HMS registers patients
// in its own canonical record and reads canonical patients whichever layer created them. It never reads or writes the
// legacy HMS. Registration is accepted by the database only once the organization's patient domain has native
// authority; until the cutover, patients are registered in the legacy HMS and reach HMS through the legacy bridge.
package patient

import (
	"context"
	"errors"
	"fmt"
	"regexp"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"hms/services/canonical/patient"
	"hms/services/canonical/recordtx"
	"hms/services/platform/audit"
)

// Registration is a request to register a patient. ID is optional: a client-generated UUID makes a retried request
// return the same record instead of creating a second one.
type Registration struct {
	ID          string               `json:"id"`
	Name        string               `json:"name"`
	Gender      string               `json:"gender"`
	BirthDate   string               `json:"birth_date"`
	BirthPlace  string               `json:"birth_place"`
	Identifiers []patient.Identifier `json:"identifiers"`
}

// ValidationError is a request the business rules refuse; Msg is safe to show.
type ValidationError struct{ Msg string }

func (e ValidationError) Error() string { return e.Msg }

// Caller is the authenticated person acting, with the request's audit context.
type Caller struct {
	UserID         string
	OrganizationID string
	FacilityID     string
	RequestID      string
	ClientAddr     string
	Channel        string
}

// Service runs native patient commands and queries.
type Service struct {
	db  *pgxpool.Pool
	now func() time.Time
}

func NewService(db *pgxpool.Pool) *Service { return &Service{db: db, now: time.Now} }

var (
	uuidPattern = regexp.MustCompile(`^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$`)
	nikPattern  = regexp.MustCompile(`^[0-9]{16}$`)
	spaces      = regexp.MustCompile(`\s+`)
)

// Identifier systems a client may supply at registration. The medical record number is not among them: it is
// allocated by HMS once its format is decided (ADR-ROOT-002 open decision), never chosen by a client.
var registrable = map[string]bool{patient.SystemNIK: true, patient.SystemPaspor: true, patient.SystemKK: true}

// NIK placeholder that means "no NIK" (Kepmenkes 1423/2022; refused by the database as well).
const nikPlaceholder = "9999999999999999"

// Validate applies the registration rules and returns the normalized patient.
func (r Registration) Validate(today time.Time) (patient.Patient, error) {
	if r.ID != "" && !uuidPattern.MatchString(r.ID) {
		return patient.Patient{}, ValidationError{"id must be a lowercase UUID"}
	}
	p := patient.Patient{
		Name:       strings.TrimSpace(spaces.ReplaceAllString(r.Name, " ")),
		Gender:     r.Gender,
		BirthDate:  r.BirthDate,
		BirthPlace: strings.TrimSpace(r.BirthPlace),
	}
	if n := utf8.RuneCountInString(p.Name); n < 1 || n > 200 {
		return patient.Patient{}, ValidationError{"name is required (at most 200 characters)"}
	}
	switch p.Gender {
	case "male", "female", "other", "unknown":
	default:
		return patient.Patient{}, ValidationError{"gender must be male, female, other or unknown"}
	}
	if p.BirthDate != "" {
		d, err := time.Parse("2006-01-02", p.BirthDate)
		if err != nil || d.Year() < 1900 || d.After(today) {
			return patient.Patient{}, ValidationError{"birth_date must be a real date (YYYY-MM-DD) not in the future"}
		}
	}
	if utf8.RuneCountInString(p.BirthPlace) > 200 {
		return patient.Patient{}, ValidationError{"birth_place is at most 200 characters"}
	}
	if len(r.Identifiers) > 5 {
		return patient.Patient{}, ValidationError{"at most 5 identifiers"}
	}
	seen := map[string]bool{}
	for _, ident := range r.Identifiers {
		ident.Value = strings.TrimSpace(ident.Value)
		if !registrable[ident.System] {
			return patient.Patient{}, ValidationError{"identifier system is not accepted at registration"}
		}
		if seen[ident.System] {
			return patient.Patient{}, ValidationError{"one identifier per system"}
		}
		seen[ident.System] = true
		if ident.Value == "" || len(ident.Value) > 100 {
			return patient.Patient{}, ValidationError{"identifier value is required (at most 100 characters)"}
		}
		if ident.System == patient.SystemNIK && (!nikPattern.MatchString(ident.Value) || ident.Value == nikPlaceholder) {
			return patient.Patient{}, ValidationError{"NIK must be 16 digits (leave it out when the patient has none)"}
		}
		p.Identifiers = append(p.Identifiers, ident)
	}
	return p, nil
}

// Errors of the native layer, mapped to HTTP by the handler.
var (
	ErrNotNative       = errors.New("patient registration is still run in the legacy HMS for this organization")
	ErrIdentifierInUse = errors.New("identifier already registered to another patient")
	ErrNotFound        = recordtx.ErrNotFound
)

// Register creates the patient as the caller, with the audit event in the same transaction. A retry with the same
// client id returns the existing record (created = false).
func (s *Service) Register(ctx context.Context, c Caller, reg Registration) (rec patient.Record, created bool, err error) {
	p, err := reg.Validate(s.now())
	if err != nil {
		return patient.Record{}, false, err
	}
	tc := recordtx.Context{OrganizationID: c.OrganizationID, Actor: recordtx.User(c.UserID), RequestID: c.RequestID}
	err = recordtx.Write(ctx, s.db, tc, func(tx pgx.Tx) error {
		// Checked first for a clear answer; the database enforces it again on every row.
		authority, err := recordtx.DomainAuthority(ctx, tx, patient.Domain)
		if err != nil {
			return err
		}
		if authority != recordtx.AuthorityNative {
			return ErrNotNative
		}
		if reg.ID != "" {
			if existing, err := patient.Get(ctx, tx, reg.ID); err == nil {
				rec = existing
				return nil
			} else if !errors.Is(err, recordtx.ErrNotFound) {
				return err
			}
		}
		id, err := patient.Create(ctx, tx, c.OrganizationID, reg.ID, p)
		if err != nil {
			return err
		}
		if rec, err = patient.Get(ctx, tx, id); err != nil {
			return err
		}
		created = true
		return audit.Write(ctx, tx, s.event(c, "patient.record.create", id))
	})
	switch {
	case errors.Is(err, recordtx.ErrNotAuthoritative):
		return patient.Record{}, false, ErrNotNative
	case errors.Is(err, recordtx.ErrConflict) && recordtx.Constraint(err) == "pk_patients":
		// The id belongs to a record this organization cannot see.
		return patient.Record{}, false, ValidationError{"id is already in use; generate a new one"}
	case errors.Is(err, recordtx.ErrConflict):
		return patient.Record{}, false, ErrIdentifierInUse
	case errors.Is(err, recordtx.ErrInvalid):
		return patient.Record{}, false, ValidationError{"the patient record was refused by a record rule"}
	case err != nil:
		return patient.Record{}, false, err
	}
	return rec, created, nil
}

// Get reads a canonical patient of the caller's organization (native or bridged) and audits the read; if the audit
// event cannot be written nothing is returned.
func (s *Service) Get(ctx context.Context, c Caller, id string) (patient.Record, error) {
	if !uuidPattern.MatchString(id) {
		return patient.Record{}, ErrNotFound
	}
	var rec patient.Record
	if err := recordtx.Read(ctx, s.db, c.OrganizationID, func(tx pgx.Tx) error {
		var err error
		rec, err = patient.Get(ctx, tx, id)
		return err
	}); err != nil {
		return patient.Record{}, err
	}
	if err := audit.Write(ctx, s.db, s.event(c, "patient.record.read", id)); err != nil {
		return patient.Record{}, fmt.Errorf("audit: %w", err)
	}
	return rec, nil
}

func (s *Service) event(c Caller, action, id string) audit.Event {
	return audit.Event{OccurredAt: s.now(), Category: audit.CategoryDataAccess, Action: action, Outcome: audit.OutcomeSuccess,
		ActorType: audit.ActorUser, ActorID: c.UserID, OrganizationID: c.OrganizationID, FacilityID: c.FacilityID,
		ResourceType: "Patient", ResourceID: id, Channel: c.Channel, RequestID: c.RequestID, ClientAddr: c.ClientAddr}
}
