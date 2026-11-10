package patient

// Native patient registration and canonical reads against PostgreSQL. Development/CI database only:
// HMS_TEST_DATABASE_URL (runtime login), HMS_TEST_BRIDGE_DATABASE_URL (legacy bridge login, to create a bridged
// patient) and HMS_TEST_ADMIN_DATABASE_URL (superuser: fixtures, the cutover procedure, inspection). Skipped when unset.

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"os"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"hms/services/canonical/patient"
	"hms/services/canonical/recordtx"
	"hms/services/platform/tenancy"
)

type env struct {
	rt, bridge, admin *pgxpool.Pool
}

func setup(t *testing.T) env {
	t.Helper()
	rtURL, bURL, adminURL := os.Getenv("HMS_TEST_DATABASE_URL"), os.Getenv("HMS_TEST_BRIDGE_DATABASE_URL"), os.Getenv("HMS_TEST_ADMIN_DATABASE_URL")
	if rtURL == "" || bURL == "" || adminURL == "" {
		t.Skip("HMS_TEST_DATABASE_URL / HMS_TEST_BRIDGE_DATABASE_URL / HMS_TEST_ADMIN_DATABASE_URL not set")
	}
	ctx := context.Background()
	var e env
	var err error
	for _, p := range []struct {
		dst **pgxpool.Pool
		url string
	}{{&e.rt, rtURL}, {&e.bridge, bURL}, {&e.admin, adminURL}} {
		if *p.dst, err = pgxpool.New(ctx, p.url); err != nil {
			t.Fatal(err)
		}
	}
	t.Cleanup(func() { e.rt.Close(); e.bridge.Close(); e.admin.Close() })
	return e
}

// organization creates an organization, a clerk and the authority of every domain (the cutover procedure's result).
func (e env) organization(t *testing.T, authority string) Caller {
	t.Helper()
	ctx := context.Background()
	b := make([]byte, 4)
	_, _ = rand.Read(b)
	tag := strings.ToUpper(hex.EncodeToString(b))
	org, err := tenancy.Ensure(ctx, e.rt, tenancy.Setup{OrganizationCode: "N" + tag, OrganizationName: "Native test",
		FacilityCode: "N" + tag + "-F", FacilityName: "Facility", Timezone: "Asia/Jakarta"})
	if err != nil {
		t.Fatal(err)
	}
	var userID string
	if err := e.admin.QueryRow(ctx, `INSERT INTO iam.users (organization_id, display_name) VALUES ($1, 'Test Clerk') RETURNING id::text`,
		org.OrganizationID).Scan(&userID); err != nil {
		t.Fatal(err)
	}
	err = pgx.BeginTxFunc(ctx, e.admin, pgx.TxOptions{}, func(tx pgx.Tx) error {
		if _, err := tx.Exec(ctx, `SELECT set_config('hms.organization_id', $1, true), set_config('hms.actor_service', 'cutover-operator', true)`,
			org.OrganizationID); err != nil {
			return err
		}
		_, err := tx.Exec(ctx, `INSERT INTO integration.domain_authority (organization_id, domain, authority, decision_reference)
SELECT $1::uuid, code, $2, 'TEST' FROM integration.record_domains`, org.OrganizationID, authority)
		return err
	})
	if err != nil {
		t.Fatal(err)
	}
	return Caller{UserID: userID, OrganizationID: org.OrganizationID, FacilityID: org.FacilityID, RequestID: "test-request-" + tag,
		Channel: "web"}
}

func TestPGNativeRegistration(t *testing.T) {
	e := setup(t)
	ctx := context.Background()
	if err := recordtx.CheckLayerRole(ctx, e.rt, false); err != nil {
		t.Fatalf("runtime login: %v", err)
	}
	if err := recordtx.CheckLayerRole(ctx, e.bridge, false); err == nil {
		t.Fatal("the bridge login must not pass as the native runtime")
	}
	svc := NewService(e.rt)
	nik := patient.Identifier{System: patient.SystemNIK, Value: "3374010101900001"}

	// Before cutover registration belongs to the legacy HMS.
	legacyOrg := e.organization(t, recordtx.AuthorityLegacy)
	if _, _, err := svc.Register(ctx, legacyOrg, Registration{Name: "A", Gender: "male"}); !errors.Is(err, ErrNotNative) {
		t.Fatalf("legacy organization: %v", err)
	}

	c := e.organization(t, recordtx.AuthorityNative)
	id := "019a0000-0000-7000-8000-" + strings.ToLower(c.RequestID[len(c.RequestID)-8:]) + "0001"
	reg := Registration{ID: id, Name: "Siti Aminah", Gender: "female", BirthDate: "1990-01-01", Identifiers: []patient.Identifier{nik}}
	rec, created, err := svc.Register(ctx, c, reg)
	if err != nil || !created || rec.ID != id || rec.Origin != "native" || rec.Version != 1 || len(rec.Identifiers) != 1 {
		t.Fatalf("register: %+v created=%v %v", rec, created, err)
	}
	again, created, err := svc.Register(ctx, c, reg)
	if err != nil || created || again.ID != id {
		t.Fatalf("a retry returns the same record: %+v created=%v %v", again, created, err)
	}
	if _, _, err := svc.Register(ctx, c, Registration{Name: "Other", Gender: "male", Identifiers: []patient.Identifier{nik}}); !errors.Is(err, ErrIdentifierInUse) {
		t.Fatalf("same NIK twice: %v", err)
	}

	// A patient the bridge mapped (in an organization whose patient domain is still legacy) reads the same way, with its
	// origin.
	bridged := ""
	legacyFixture := e.organization(t, recordtx.AuthorityLegacy)
	err = recordtx.Write(ctx, e.bridge, recordtx.Context{OrganizationID: legacyFixture.OrganizationID, Actor: recordtx.Service(recordtx.BridgeService)},
		func(tx pgx.Tx) error {
			var err error
			bridged, err = patient.Create(ctx, tx, legacyFixture.OrganizationID, "", patient.Patient{Name: "Budi", Gender: "male",
				Identifiers: []patient.Identifier{{System: patient.SystemMRN, Value: "000777"}, nik}})
			return err
		})
	if err != nil {
		t.Fatalf("bridge fixture: %v", err)
	}
	got, err := svc.Get(ctx, legacyFixture, bridged)
	if err != nil || got.Origin != "legacy" || got.Name != "Budi" {
		t.Fatalf("read bridged patient: %+v %v", got, err)
	}
	v := toView(got)
	for _, i := range v.Identifiers {
		if i.System == patient.SystemNIK && (!i.Masked || i.Value != "••••••••••••0001") {
			t.Errorf("NIK must be masked: %+v", i)
		}
		if i.System == patient.SystemMRN && (i.Masked || i.Value != "000777") {
			t.Errorf("MRN is shown: %+v", i)
		}
	}
	if _, err := svc.Get(ctx, c, bridged); !errors.Is(err, ErrNotFound) {
		t.Errorf("another organization's patient must not be found: %v", err)
	}

	var audits int
	if err := e.admin.QueryRow(ctx, `SELECT count(*) FROM audit.audit_events WHERE organization_id IN ($1, $2)
AND action IN ('patient.record.create', 'patient.record.read') AND actor_id IN ($3, $4)`,
		c.OrganizationID, legacyFixture.OrganizationID, c.UserID, legacyFixture.UserID).Scan(&audits); err != nil || audits != 2 {
		t.Errorf("audit events = %d, want 2 (one create, one read): %v", audits, err)
	}
}
