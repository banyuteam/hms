// Package audit writes events to audit.audit_events (hms_database migration 0002). The table is append-only and
// hash-chained by the database; the runtime role may only INSERT descriptive columns. Events carry identifiers and
// outcomes, never record contents, passwords, tokens or typed user IDs.
package audit

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5/pgconn"
)

// Categories and outcomes allowed by the database (ck_audit_events_category, ck_audit_events_outcome).
const (
	CategoryAuthentication = "authentication"
	CategoryAuthorization  = "authorization"
	CategoryAdministration = "administration"
	CategoryDataAccess     = "data_access"

	OutcomeSuccess = "success"
	OutcomeDenied  = "denied"
	OutcomeFailure = "failure"

	ActorUser      = "user"
	ActorSystem    = "system"
	ActorAnonymous = "anonymous"
)

type Event struct {
	OccurredAt     time.Time
	Category       string
	Action         string // e.g. session.sign_in
	Outcome        string
	ActorType      string
	ActorID        string // iam.users.id; empty for anonymous
	OrganizationID string
	FacilityID     string
	ResourceType   string
	ResourceID     string
	Channel        string // web | android | ios | system
	RequestID      string
	ClientAddr     string
	Detail         map[string]string // small, non-PHI
}

// Execer is a pgx pool, connection or transaction.
type Execer interface {
	Exec(ctx context.Context, sql string, args ...any) (pgconn.CommandTag, error)
}

const insertSQL = `INSERT INTO audit.audit_events
    (occurred_at, category, action, outcome, actor_type, actor_id, organization_id, facility_id,
     resource_type, resource_id, channel, request_id, client_addr, detail)
VALUES ($1, $2, $3, $4, $5, NULLIF($6, ''), NULLIF($7, '')::uuid, NULLIF($8, '')::uuid,
        NULLIF($9, ''), NULLIF($10, ''), NULLIF($11, ''), NULLIF($12, ''), NULLIF($13, '')::inet, $14::jsonb)`

// Write appends the event. Inside a transaction it commits or rolls back with the audited change.
func Write(ctx context.Context, db Execer, e Event) error {
	detail := e.Detail
	if detail == nil {
		detail = map[string]string{}
	}
	d, err := json.Marshal(detail)
	if err != nil {
		return fmt.Errorf("audit detail: %w", err)
	}
	var occurred any
	if !e.OccurredAt.IsZero() {
		occurred = e.OccurredAt
	}
	_, err = db.Exec(ctx, insertSQL, occurred, e.Category, e.Action, e.Outcome, e.ActorType, e.ActorID,
		e.OrganizationID, e.FacilityID, e.ResourceType, e.ResourceID, e.Channel, e.RequestID, e.ClientAddr, string(d))
	if err != nil {
		return fmt.Errorf("write audit event %s: %w", e.Action, err)
	}
	return nil
}
