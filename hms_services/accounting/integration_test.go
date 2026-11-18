package accounting

// Full stack over HTTP against PostgreSQL (real sessions, permissions and audit trail) with a stub accounting
// reader. Development/CI database only: HMS_TEST_DATABASE_URL (runtime role) and HMS_TEST_ADMIN_DATABASE_URL
// (superuser, inspection only). Skipped when unset.

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"hms/services/core/httpx"
	"hms/services/integrations/legacyhms"
	"hms/services/platform/audit"
	"hms/services/platform/iam"
	"hms/services/platform/tenancy"
)

type staff struct{}

func (staff) Verify(_ context.Context, userID, password string) (legacyhms.Identity, error) {
	if password != "pw" {
		return legacyhms.Identity{}, legacyhms.ErrInvalid
	}
	return legacyhms.Identity{Issuer: legacyhms.IssuerEmployee, Subject: userID, DisplayName: "Staff " + userID}, nil
}

func (staff) Active(context.Context, string, string) (bool, error) { return true, nil }

// stubReader answers every report with the smallest body its struct accepts. The bodies matter only in that they
// must decode: what this test proves is who may read, and that every read leaves a trail.
type stubReader struct{}

func (stubReader) Get(_ context.Context, path string, _ url.Values, out any) error {
	bodies := map[string]string{
		"/api/v1/laporan/neraca": `{"periode":{"tahun":2026,"bulan":11},
			"aset":{"baris":[],"total":0},"kewajiban":{"baris":[],"total":0},"ekuitas":{"baris":[],"total":0},
			"laba_tahun_lalu":0,"laba_rugi_berjalan":0,"total_kewajiban_ekuitas":0,"selisih":0}`,
		"/api/v1/laporan/laba-rugi": `{"periode":{"tahun":2026,"bulan":11},
			"pendapatan":[],"hpp":[],"beban":[],"biaya_lain":[],"pajak":[],
			"total":{"pendapatan":0,"hpp":0,"beban":0,"biaya_lain":0,"pajak":0,"laba_kotor":0,"laba_operasi":0,"laba_rugi":0}}`,
		"/api/v1/laporan/neraca-saldo": `{"periode":{"tahun":2026,"bulan":11},
			"data":{"rows":[],"total_debit":0,"total_credit":0,"is_balanced":true,"period_year":2026,"period_month":11}}`,
		"/api/v1/laporan/neraca-lajur": `{"periode":{"tahun":2026,"bulan":11},
			"data":{"rows":[],
			"totals":{"ns_debit":0,"ns_credit":0,"lr_debit":0,"lr_credit":0,"ner_debit":0,"ner_credit":0},
			"penyeimbang":{"lr_debit":0,"lr_credit":0,"ner_debit":0,"ner_credit":0},
			"totals_akhir":{"ns_debit":0,"ns_credit":0,"lr_debit":0,"lr_credit":0,"ner_debit":0,"ner_credit":0},
			"jembatan":{"ns":0,"lr":0,"ner":0},
			"totals_konvensi":{"ns_debit":0,"ns_credit":0,"lr_debit":0,"lr_credit":0,"ner_debit":0,"ner_credit":0},
			"laba_rugi":0,"laba_tahun_lalu":0,"year":2026,"month":11}}`,
		"/api/v1/laporan/cash-flow": `{"periode":{"tahun":2026,"bulan":11},
			"penerimaan":[],"pengeluaran":[],"total":{"penerimaan":0,"pengeluaran":0,"net":0},
			"saldo_awal":0,"saldo_akhir":0}`,
		"/api/v1/laporan/buku-besar": `{"periode":{"tahun":2026,"bulan":11},"akun":[]}`,
		"/api/v1/laporan/aging": `{"type":"receivable","rows":[],
			"grand_total":{"name":"","penjamin":null,"current":0,"b31_60":0,"b61_90":0,"b91_180":0,"over180":0,"total":0},
			"buckets":{},"as_of_date":"30 September 2026"}`,
	}
	body, ok := bodies[path]
	if !ok {
		return fmt.Errorf("stubReader: no body for %s", path)
	}
	return json.Unmarshal([]byte(body), out)
}

func systemEvent(orgID string) audit.Event {
	return audit.Event{Category: audit.CategoryAdministration, Action: "iam.permission.registered",
		Outcome: audit.OutcomeSuccess, ActorType: audit.ActorSystem, OrganizationID: orgID, Channel: "system"}
}

// report names one endpoint and the permission that opens it.
type report struct {
	path       string
	permission string
	action     string
}

var reports = []report{
	{"/api/v1/accounting/neraca?year=2026&month=11", PermNeracaRead, "accounting.neraca.read"},
	{"/api/v1/accounting/laba-rugi?year=2026&month=11", PermLabaRugiRead, "accounting.laba_rugi.read"},
	{"/api/v1/accounting/neraca-saldo?year=2026&month=11", PermNeracaSaldoRead, "accounting.neraca_saldo.read"},
	{"/api/v1/accounting/neraca-lajur?year=2026&month=11", PermNeracaLajurRead, "accounting.neraca_lajur.read"},
	{"/api/v1/accounting/cash-flow?year=2026&month=11", PermCashFlowRead, "accounting.cash_flow.read"},
	{"/api/v1/accounting/buku-besar?year=2026&month=11&account_id=3", PermBukuBesarRead, "accounting.buku_besar.read"},
	{"/api/v1/accounting/aging?type=receivable", PermAgingRead, "accounting.aging.read"},
}

func TestPGAccountingPermissionsAndAudit(t *testing.T) {
	rtURL, adminURL := os.Getenv("HMS_TEST_DATABASE_URL"), os.Getenv("HMS_TEST_ADMIN_DATABASE_URL")
	if rtURL == "" || adminURL == "" {
		t.Skip("HMS_TEST_DATABASE_URL / HMS_TEST_ADMIN_DATABASE_URL not set")
	}
	ctx := context.Background()
	rt, err := pgxpool.New(ctx, rtURL)
	if err != nil {
		t.Fatal(err)
	}
	admin, err := pgxpool.New(ctx, adminURL)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { rt.Close(); admin.Close() })

	b := make([]byte, 4)
	_, _ = rand.Read(b)
	tag := strings.ToUpper(hex.EncodeToString(b))
	org, err := tenancy.Ensure(ctx, rt, tenancy.Setup{OrganizationCode: "A" + tag, OrganizationName: "Accounting test",
		FacilityCode: "A" + tag + "-F", FacilityName: "Facility", Timezone: "Asia/Jakarta"})
	if err != nil {
		t.Fatal(err)
	}

	store := iam.NewPgStore(rt)
	if _, err := store.SyncPermissions(ctx, append(append([]iam.PermissionDef{}, iam.Registry...), Permissions...),
		systemEvent(org.OrganizationID)); err != nil {
		t.Fatal(err)
	}

	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	svc := iam.NewService(store, staff{}, iam.Options{OrganizationID: org.OrganizationID, FacilityID: org.FacilityID,
		IdleTimeout: 15 * time.Minute, AbsoluteTTL: time.Hour,
		Lockout: iam.LockoutPolicy{Failures: 5, Window: time.Minute, Duration: time.Minute}, Logger: logger})
	origin, _ := url.Parse("https://hms.test.invalid")
	ih := iam.NewHandler(svc, iam.HTTPOptions{PublicOrigin: origin, SecureCookies: true, SignInPerIP: 100})
	mux := http.NewServeMux()
	ih.Register(mux)
	NewHandler(stubReader{}, store, ih, logger).Register(mux)
	srv := httptest.NewServer(httpx.Middleware(logger, mux))
	t.Cleanup(srv.Close)

	signIn := func(login string) (string, *http.Cookie) {
		req, _ := http.NewRequest("POST", srv.URL+"/api/v1/auth/sign-in",
			strings.NewReader(fmt.Sprintf(`{"user_id":%q,"password":"pw"}`, login)))
		req.Header.Set("Origin", origin.String())
		req.Header.Set("Content-Type", "application/json")
		resp, err := http.DefaultClient.Do(req)
		if err != nil || resp.StatusCode != 200 {
			t.Fatalf("sign-in %s: %v %v", login, err, resp)
		}
		defer resp.Body.Close()
		var body struct {
			User struct{ ID string } `json:"user"`
		}
		_ = json.NewDecoder(resp.Body).Decode(&body)
		return body.User.ID, resp.Cookies()[0]
	}

	get := func(c *http.Cookie, path string) (int, string) {
		req, _ := http.NewRequest("GET", srv.URL+path, nil)
		req.AddCookie(c)
		resp, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		defer resp.Body.Close()
		b, _ := io.ReadAll(resp.Body)
		return resp.StatusCode, string(b)
	}

	roles := 0
	grant := func(userID string, perms ...string) {
		roles++
		var roleID string
		if err := rt.QueryRow(ctx, `INSERT INTO iam.roles (code,name) VALUES ($1, 'Accounting test') RETURNING id::text`,
			"at-"+strings.ToLower(tag)+"-"+fmt.Sprint(roles)).Scan(&roleID); err != nil {
			t.Fatal(err)
		}
		for _, p := range perms {
			if _, err := rt.Exec(ctx, `INSERT INTO iam.role_permissions (role_id, permission_code) VALUES ($1::uuid, $2)`,
				roleID, p); err != nil {
				t.Fatal(err)
			}
		}
		if _, err := rt.Exec(ctx, `INSERT INTO iam.role_assignments (user_id, role_id, organization_id) VALUES ($1::uuid, $2::uuid, $3::uuid)`,
			userID, roleID, org.OrganizationID); err != nil {
			t.Fatal(err)
		}
	}

	// A signed-in session with no permission at all reaches none of the seven.
	userID, c := signIn("ACC" + tag)
	for _, r := range reports {
		if s, _ := get(c, r.path); s != 403 {
			t.Errorf("%s without permission: %d", r.path, s)
		}
	}

	// One permission opens one report and nothing else. This is the whole reason the permissions are granted one
	// by one rather than as a single accounting.read: whoever may see the balance sheet must not thereby see
	// ageing, which names counterparties and what each of them owes.
	grant(userID, PermNeracaRead)
	for _, r := range reports {
		s, body := get(c, r.path)
		want := 403
		if r.permission == PermNeracaRead {
			want = 200
		}
		if s != want {
			t.Errorf("%s with only %s: got %d, want %d (%s)", r.path, PermNeracaRead, s, want, body)
		}
	}

	// Every read left a trail. Checked through the admin pool because the runtime role may not read audit events
	// back — it appends only.
	var n int
	if err := admin.QueryRow(ctx,
		`SELECT count(*) FROM audit.audit_events WHERE organization_id = $1::uuid AND action = 'accounting.neraca.read'`,
		org.OrganizationID).Scan(&n); err != nil {
		t.Fatal(err)
	}
	if n != 1 {
		t.Errorf("audit events for the one allowed read: %d", n)
	}

	// A second session holding every permission reads all seven, and each leaves its own action.
	user2, c2 := signIn("ACCB" + tag)
	all := make([]string, 0, len(reports))
	for _, r := range reports {
		all = append(all, r.permission)
	}
	grant(user2, all...)

	for _, r := range reports {
		if s, body := get(c2, r.path); s != 200 {
			t.Errorf("%s with every permission: %d (%s)", r.path, s, body)
		}
	}

	for _, r := range reports {
		var m int
		if err := admin.QueryRow(ctx,
			`SELECT count(*) FROM audit.audit_events WHERE organization_id = $1::uuid AND action = $2`,
			org.OrganizationID, r.action).Scan(&m); err != nil {
			t.Fatal(err)
		}
		if m == 0 {
			t.Errorf("%s: no audit event with action %s", r.path, r.action)
		}
	}
}