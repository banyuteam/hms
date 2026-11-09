// Package tenancy resolves and creates the organization (tenant) and facility rows in platform (hms_database
// migration 0001). Rows are never seeded by migrations: an operator creates them once with
// `hms-services setup-organization`.
package tenancy

import (
	"context"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"hms/services/platform/audit"
)

type Setup struct {
	OrganizationCode string
	OrganizationName string
	FacilityCode     string
	FacilityName     string
	Timezone         string
}

type Result struct {
	OrganizationID      string
	FacilityID          string
	OrganizationCreated bool
	FacilityCreated     bool
}

var ErrNotFound = errors.New("organization or facility not found")

// Resolve returns the ids of an active organization and facility by code.
func Resolve(ctx context.Context, db *pgxpool.Pool, orgCode, facilityCode string) (orgID, facilityID string, err error) {
	err = db.QueryRow(ctx, `
SELECT o.id::text, f.id::text
FROM platform.organizations o
JOIN platform.facilities f ON f.organization_id = o.id
WHERE o.code = $1 AND f.code = $2 AND o.status = 'active' AND f.status = 'active'`,
		orgCode, facilityCode).Scan(&orgID, &facilityID)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", "", ErrNotFound
	}
	return orgID, facilityID, err
}

// FacilityTimezone returns the IANA time zone of a facility (local clinical times are interpreted in it).
func FacilityTimezone(ctx context.Context, db *pgxpool.Pool, facilityID string) (string, error) {
	var tz string
	err := db.QueryRow(ctx, `SELECT timezone FROM platform.facilities WHERE id = $1::uuid`, facilityID).Scan(&tz)
	return tz, err
}

// Ensure creates the organization and facility when missing (idempotent; existing rows are not changed) and audits
// each creation in the same transaction.
func Ensure(ctx context.Context, db *pgxpool.Pool, s Setup) (Result, error) {
	var res Result
	err := pgx.BeginTxFunc(ctx, db, pgx.TxOptions{IsoLevel: pgx.ReadCommitted}, func(tx pgx.Tx) error {
		tag, err := tx.Exec(ctx, `INSERT INTO platform.organizations (code, name) VALUES ($1, $2) ON CONFLICT (code) DO NOTHING`,
			s.OrganizationCode, s.OrganizationName)
		if err != nil {
			return err
		}
		res.OrganizationCreated = tag.RowsAffected() == 1
		if err := tx.QueryRow(ctx, `SELECT id::text FROM platform.organizations WHERE code = $1`, s.OrganizationCode).
			Scan(&res.OrganizationID); err != nil {
			return err
		}
		tag, err = tx.Exec(ctx, `INSERT INTO platform.facilities (organization_id, code, name, timezone)
                                VALUES ($1::uuid, $2, $3, $4) ON CONFLICT (organization_id, code) DO NOTHING`,
			res.OrganizationID, s.FacilityCode, s.FacilityName, s.Timezone)
		if err != nil {
			return err
		}
		res.FacilityCreated = tag.RowsAffected() == 1
		if err := tx.QueryRow(ctx, `SELECT id::text FROM platform.facilities WHERE organization_id = $1::uuid AND code = $2`,
			res.OrganizationID, s.FacilityCode).Scan(&res.FacilityID); err != nil {
			return err
		}
		for _, c := range []struct {
			created      bool
			action, kind string
			id           string
		}{
			{res.OrganizationCreated, "platform.organization.created", "Organization", res.OrganizationID},
			{res.FacilityCreated, "platform.facility.created", "Facility", res.FacilityID},
		} {
			if !c.created {
				continue
			}
			if err := audit.Write(ctx, tx, audit.Event{
				Category: audit.CategoryAdministration, Action: c.action, Outcome: audit.OutcomeSuccess,
				ActorType: audit.ActorSystem, OrganizationID: res.OrganizationID, ResourceType: c.kind, ResourceID: c.id,
				Channel: "system", Detail: map[string]string{"tool": "setup-organization"},
			}); err != nil {
				return err
			}
		}
		return nil
	})
	if err != nil {
		return Result{}, fmt.Errorf("setup organization: %w", err)
	}
	return res, nil
}
