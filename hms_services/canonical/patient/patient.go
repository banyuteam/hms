// Package patient reads and writes the canonical Patient record (hms_database migration 0010: patient.patients,
// patient.names, patient.identifiers) for both layers of ADR-ROOT-002. It holds the record's shape only: business
// rules belong to the native layer, legacy interpretation to the bridge's mapping, and who may write which
// organization's patients is enforced by the database (domain authority, tenant row-level security). Every call runs
// inside a recordtx transaction.
package patient

import (
	"context"
	"errors"
	"fmt"
	"slices"
	"time"

	"github.com/jackc/pgx/v5"

	"hms/services/canonical/recordtx"
)

// Domain is the record domain of patients (integration.record_domains).
const Domain = "patient"

// Identifier systems (terminology.identifier_systems).
const (
	SystemMRN    = "urn:hms:id:mrn"
	SystemNIK    = "https://fhir.kemkes.go.id/id/nik"
	SystemPaspor = "https://fhir.kemkes.go.id/id/paspor"
	SystemKK     = "https://fhir.kemkes.go.id/id/kk"
)

// Identifier is one active identifier.
type Identifier struct {
	System string `json:"system"`
	Value  string `json:"value"`
}

// Patient is the part of the record both layers write: the official name, administrative gender (male | female |
// other | unknown), birth date (YYYY-MM-DD) and place when recorded, and the active identifiers.
type Patient struct {
	Name        string
	Gender      string
	BirthDate   string // "" = not recorded
	BirthPlace  string // "" = not recorded
	Identifiers []Identifier
}

// Record is a stored patient.
type Record struct {
	Patient
	ID        string
	Version   int
	Origin    string // native | legacy: the layer that created it
	Active    bool
	UpdatedAt time.Time
}

// Create inserts a patient with its official name and identifiers. id may be "" (the database assigns one) or a
// client-chosen UUID, so a retried request cannot create a second record.
func Create(ctx context.Context, tx pgx.Tx, organizationID, id string, p Patient) (string, error) {
	err := tx.QueryRow(ctx, `INSERT INTO patient.patients (id, organization_id, administrative_gender, birth_date, birth_place)
VALUES (coalesce(NULLIF($1, '')::uuid, uuidv7()), $2::uuid, $3, NULLIF($4, '')::date, NULLIF($5, ''))
RETURNING id::text`, id, organizationID, p.Gender, p.BirthDate, p.BirthPlace).Scan(&id)
	if err != nil {
		return "", fmt.Errorf("insert patient: %w", err)
	}
	if _, err := tx.Exec(ctx, `INSERT INTO patient.names (organization_id, patient_id, use, text) VALUES ($1::uuid, $2::uuid, 'official', $3)`,
		organizationID, id, p.Name); err != nil {
		return "", fmt.Errorf("insert patient name: %w", err)
	}
	for _, ident := range p.Identifiers {
		if err := addIdentifier(ctx, tx, organizationID, id, ident); err != nil {
			return "", err
		}
	}
	return id, nil
}

func addIdentifier(ctx context.Context, tx pgx.Tx, organizationID, patientID string, ident Identifier) error {
	_, err := tx.Exec(ctx, `INSERT INTO patient.identifiers (organization_id, patient_id, system_uri, value) VALUES ($1::uuid, $2::uuid, $3, $4)`,
		organizationID, patientID, ident.System, ident.Value)
	if err != nil {
		return fmt.Errorf("insert patient identifier %s: %w", ident.System, err)
	}
	return nil
}

// Replace makes the stored patient equal to p, writing only what differs: demographics are updated in place; a
// changed official name and identifiers that are no longer present are deactivated (kept as history) and the new
// ones added. Identifiers not in p are deactivated, so p must hold the complete set. Reports whether anything changed.
func Replace(ctx context.Context, tx pgx.Tx, organizationID, id string, p Patient) (bool, error) {
	cur, err := Get(ctx, tx, id)
	if err != nil {
		return false, err
	}
	changed := false
	if cur.Gender != p.Gender || cur.BirthDate != p.BirthDate || cur.BirthPlace != p.BirthPlace {
		if _, err := tx.Exec(ctx, `UPDATE patient.patients SET administrative_gender = $2, birth_date = NULLIF($3, '')::date,
       birth_place = NULLIF($4, '') WHERE id = $1::uuid`, id, p.Gender, p.BirthDate, p.BirthPlace); err != nil {
			return false, fmt.Errorf("update patient: %w", err)
		}
		changed = true
	}
	if cur.Name != p.Name {
		if _, err := tx.Exec(ctx, `UPDATE patient.names SET active = false WHERE patient_id = $1::uuid AND use = 'official' AND active`, id); err != nil {
			return false, fmt.Errorf("retire patient name: %w", err)
		}
		if _, err := tx.Exec(ctx, `INSERT INTO patient.names (organization_id, patient_id, use, text) VALUES ($1::uuid, $2::uuid, 'official', $3)`,
			organizationID, id, p.Name); err != nil {
			return false, fmt.Errorf("insert patient name: %w", err)
		}
		changed = true
	}
	for _, old := range cur.Identifiers {
		if slices.Contains(p.Identifiers, old) {
			continue
		}
		if _, err := tx.Exec(ctx, `UPDATE patient.identifiers SET active = false
WHERE patient_id = $1::uuid AND system_uri = $2 AND value = $3 AND active`, id, old.System, old.Value); err != nil {
			return false, fmt.Errorf("retire patient identifier %s: %w", old.System, err)
		}
		changed = true
	}
	for _, ident := range p.Identifiers {
		if slices.Contains(cur.Identifiers, ident) {
			continue
		}
		if err := addIdentifier(ctx, tx, organizationID, id, ident); err != nil {
			return false, err
		}
		changed = true
	}
	return changed, nil
}

// Get returns a patient of the transaction's organization with its active official name and active identifiers.
func Get(ctx context.Context, tx pgx.Tx, id string) (Record, error) {
	var r Record
	err := tx.QueryRow(ctx, `SELECT p.id::text, p.version, p.record_origin, p.active, p.updated_at, p.administrative_gender,
       coalesce(p.birth_date::text, ''), coalesce(p.birth_place, ''),
       coalesce((SELECT n.text FROM patient.names n WHERE n.patient_id = p.id AND n.use = 'official' AND n.active
                 ORDER BY n.created_at DESC LIMIT 1), '')
FROM patient.patients p WHERE p.id = $1::uuid`, id).Scan(&r.ID, &r.Version, &r.Origin, &r.Active, &r.UpdatedAt, &r.Gender,
		&r.BirthDate, &r.BirthPlace, &r.Name)
	if errors.Is(err, pgx.ErrNoRows) {
		return Record{}, recordtx.ErrNotFound
	}
	if err != nil {
		return Record{}, fmt.Errorf("read patient: %w", err)
	}
	rows, err := tx.Query(ctx, `SELECT system_uri, value FROM patient.identifiers WHERE patient_id = $1::uuid AND active
ORDER BY system_uri, value`, id)
	if err != nil {
		return Record{}, fmt.Errorf("read patient identifiers: %w", err)
	}
	r.Identifiers, err = pgx.CollectRows(rows, func(row pgx.CollectableRow) (Identifier, error) {
		var i Identifier
		return i, row.Scan(&i.System, &i.Value)
	})
	if err != nil {
		return Record{}, fmt.Errorf("read patient identifiers: %w", err)
	}
	return r, nil
}
