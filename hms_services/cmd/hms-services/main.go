// Command hms-services is the HMS backend runtime (modular monolith).
//
//	hms-services [-env-file FILE] serve
//	hms-services [-env-file FILE] setup-organization -org-code RSUB2 -org-name "..." -facility-code RSUB2-MAIN \
//	             -facility-name "..." -timezone Asia/Jakarta
//
// Configuration comes from the environment (see .env.example); -env-file loads KEY=VALUE lines for local
// development, with real environment variables taking precedence.
package main

import (
	"bufio"
	"context"
	"database/sql"
	"errors"
	"flag"
	"fmt"
	"log/slog"
	"net"
	"net/http"
	"net/netip"
	"os"
	"os/signal"
	"slices"
	"sort"
	"strings"
	"syscall"
	"time"
	_ "time/tzdata" // facility time zones resolve in minimal containers too

	"github.com/jackc/pgx/v5/pgxpool"

	"hms/services/assistant"
	"hms/services/assistant/rules"
	"hms/services/clinical"
	"hms/services/core/config"
	"hms/services/core/httpx"
	"hms/services/integrations/legacyhms"
	"hms/services/platform/audit"
	"hms/services/platform/iam"
	"hms/services/platform/tenancy"
	"hms/services/tariffs"
)

func main() {
	if err := run(os.Args[1:]); err != nil {
		fmt.Fprintln(os.Stderr, "hms-services:", err)
		os.Exit(1)
	}
}

func run(args []string) error {
	global := flag.NewFlagSet("hms-services", flag.ContinueOnError)
	envFile := global.String("env-file", "", "load KEY=VALUE settings from this file (development)")
	if err := global.Parse(args); err != nil {
		return err
	}
	lookup, err := environment(*envFile)
	if err != nil {
		return err
	}
	rest := global.Args()
	if len(rest) == 0 {
		return errors.New("usage: hms-services [-env-file FILE] serve | healthcheck | setup-organization | check-legacy-key | check-clinical-read | check-bill-sources | inventory-legacy-schema | bootstrap-admin")
	}
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	switch rest[0] {
	case "serve":
		return serve(ctx, lookup)
	case "healthcheck":
		return healthcheck(ctx, lookup)
	case "setup-organization":
		return setupOrganization(ctx, lookup, rest[1:])
	case "check-legacy-key":
		return checkLegacyKey(ctx, lookup)
	case "bootstrap-admin":
		return bootstrapAdmin(ctx, lookup, rest[1:])
	case "check-clinical-read":
		return checkClinicalRead(ctx, lookup)
	case "check-bill-sources":
		return checkBillSources(ctx, lookup, rest[1:])
	case "inventory-legacy-schema":
		return inventoryLegacySchema(ctx, lookup, rest[1:])
	default:
		return fmt.Errorf("unknown command %q", rest[0])
	}
}

func serve(ctx context.Context, lookup config.Lookup) error {
	cfg, err := config.Load(lookup)
	if err != nil {
		return err
	}
	logger := newLogger(cfg.LogLevel)

	pool, err := openPostgres(ctx, cfg.Database)
	if err != nil {
		return err
	}
	defer pool.Close()
	orgID, facilityID, err := tenancy.Resolve(ctx, pool, cfg.OrganizationCode, cfg.FacilityCode)
	if errors.Is(err, tenancy.ErrNotFound) {
		return fmt.Errorf("organization %s / facility %s not found or inactive: run `hms-services setup-organization` first",
			cfg.OrganizationCode, cfg.FacilityCode)
	}
	if err != nil {
		return fmt.Errorf("resolve organization: %w", err)
	}

	legacyDB, err := legacyhms.Open(cfg.Legacy)
	if err != nil {
		return err
	}
	defer legacyDB.Close()
	checker, err := legacyhms.NewChecker(legacyhms.QuerierFor(legacyDB),
		[]byte(cfg.LegacyLogin.IDKey.Reveal()), []byte(cfg.LegacyLogin.PasswordKey.Reveal()), cfg.LegacyLogin.EmployeeField)
	if err != nil {
		return err
	}

	tz, err := tenancy.FacilityTimezone(ctx, pool, facilityID)
	if err != nil {
		return fmt.Errorf("facility time zone: %w", err)
	}
	loc, err := time.LoadLocation(tz)
	if err != nil {
		return fmt.Errorf("facility time zone %q: %w", tz, err)
	}

	store := iam.NewPgStore(pool)
	added, err := store.SyncPermissions(ctx, permissionRegistry(), systemEvent(orgID, "iam.permission.registered"))
	if err != nil {
		return fmt.Errorf("register permissions: %w", err)
	}
	if len(added) > 0 {
		logger.Info("registered new permissions", "permissions", added)
	}
	svc := iam.NewService(store, checker, iam.Options{
		OrganizationID: orgID, FacilityID: facilityID,
		IdleTimeout: cfg.Session.Idle, AbsoluteTTL: cfg.Session.Absolute, ActiveCacheTTL: cfg.Session.ActiveCacheTTL,
		Lockout: iam.LockoutPolicy{Failures: cfg.SignIn.LockoutFailures, Window: cfg.SignIn.LockoutWindow,
			Duration: cfg.SignIn.LockoutDuration},
		Logger: logger,
	})
	mux := http.NewServeMux()
	handler := iam.NewHandler(svc, iam.HTTPOptions{
		PublicOrigin: cfg.PublicOrigin, SecureCookies: cfg.SecureCookies(), TrustedProxies: cfg.TrustedProxies,
		SignInPerIP: cfg.SignIn.PerIPPerMinute,
	})
	handler.Register(mux)
	handler.RegisterAdmin(mux, iam.NewAdmin(store, nil))
	clinicalReader := legacyhms.NewClinical(legacyhms.RowsQuerierFor(legacyDB))
	clinical.NewHandler(clinicalReader, store, handler, loc, logger).Register(mux)
	tariffs.NewHandler(legacyhms.NewTariff(legacyhms.RowsQuerierFor(legacyDB)), store, handler, logger).Register(mux)
	assistant.NewHandler(clinicalReader, store, handler, loc, logger).Register(mux)
	mux.HandleFunc("GET /healthz", func(w http.ResponseWriter, _ *http.Request) {
		httpx.WriteJSON(w, http.StatusOK, map[string]string{"status": "ok"})
	})
	mux.HandleFunc("GET /readyz", readiness(pool, legacyDB))
	mux.HandleFunc("/", func(w http.ResponseWriter, _ *http.Request) {
		httpx.WriteError(w, http.StatusNotFound, "not_found", "Not found.")
	})

	srv := &http.Server{
		Addr:              cfg.HTTPAddr,
		Handler:           httpx.Middleware(logger, mux),
		ReadHeaderTimeout: 5 * time.Second,
		ReadTimeout:       15 * time.Second,
		WriteTimeout:      30 * time.Second,
		IdleTimeout:       60 * time.Second,
		MaxHeaderBytes:    16 << 10,
	}
	errc := make(chan error, 1)
	go func() { errc <- srv.ListenAndServe() }()
	logger.Info("hms-services listening", "addr", cfg.HTTPAddr, "env", cfg.Env,
		"organization", cfg.OrganizationCode, "facility", cfg.FacilityCode)

	select {
	case err := <-errc:
		return err
	case <-ctx.Done():
	}
	logger.Info("shutting down")
	shutdownCtx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	return srv.Shutdown(shutdownCtx)
}

// readiness reports whether both databases answer; it names the failing dependency but no details.
func readiness(pool *pgxpool.Pool, legacy *sql.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		ctx, cancel := context.WithTimeout(r.Context(), 2*time.Second)
		defer cancel()
		checks := map[string]string{"database": "ok", "legacy_hms": "ok"}
		ready := true
		if err := pool.Ping(ctx); err != nil {
			checks["database"], ready = "unavailable", false
		}
		if err := legacy.PingContext(ctx); err != nil {
			checks["legacy_hms"], ready = "unavailable", false
		}
		status, word := http.StatusOK, "ready"
		if !ready {
			status, word = http.StatusServiceUnavailable, "not_ready"
		}
		httpx.WriteJSON(w, status, map[string]any{"status": word, "checks": checks})
	}
}

// healthcheck probes this process's own GET /healthz (liveness, not readiness), for container health checks in images
// without a shell or HTTP client. It reads only HTTP_ADDR.
func healthcheck(ctx context.Context, lookup config.Lookup) error {
	addr, _ := lookup("HTTP_ADDR")
	target, err := healthURL(addr)
	if err != nil {
		return err
	}
	ctx, cancel := context.WithTimeout(ctx, 3*time.Second)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, target, nil)
	if err != nil {
		return err
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return fmt.Errorf("healthcheck: %w", err)
	}
	resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("healthcheck: status %d", resp.StatusCode)
	}
	return nil
}

// healthURL maps a listen address (HTTP_ADDR, default 127.0.0.1:8080) to the loopback /healthz URL.
func healthURL(addr string) (string, error) {
	if strings.TrimSpace(addr) == "" {
		addr = "127.0.0.1:8080"
	}
	host, port, err := net.SplitHostPort(strings.TrimSpace(addr))
	if err != nil || port == "" {
		return "", fmt.Errorf("healthcheck: HTTP_ADDR %q is not host:port", addr)
	}
	if ip, err := netip.ParseAddr(host); host == "" || (err == nil && ip.IsUnspecified()) {
		host = "127.0.0.1"
	}
	return "http://" + net.JoinHostPort(host, port) + "/healthz", nil
}

func setupOrganization(ctx context.Context, lookup config.Lookup, args []string) error {
	fs := flag.NewFlagSet("setup-organization", flag.ContinueOnError)
	s := tenancy.Setup{}
	fs.StringVar(&s.OrganizationCode, "org-code", "", "organization code, e.g. RSUB2")
	fs.StringVar(&s.OrganizationName, "org-name", "", "organization name")
	fs.StringVar(&s.FacilityCode, "facility-code", "", "facility code, e.g. RSUB2-MAIN")
	fs.StringVar(&s.FacilityName, "facility-name", "", "facility name")
	fs.StringVar(&s.Timezone, "timezone", "Asia/Jakarta", "IANA time zone of the facility")
	if err := fs.Parse(args); err != nil {
		return err
	}
	if s.OrganizationCode == "" || s.OrganizationName == "" || s.FacilityCode == "" || s.FacilityName == "" {
		return errors.New("setup-organization needs -org-code, -org-name, -facility-code and -facility-name")
	}
	if _, err := time.LoadLocation(s.Timezone); err != nil {
		return fmt.Errorf("unknown time zone %q", s.Timezone)
	}
	dbCfg, err := config.LoadDatabase(lookup)
	if err != nil {
		return err
	}
	pool, err := openPostgres(ctx, dbCfg)
	if err != nil {
		return err
	}
	defer pool.Close()
	res, err := tenancy.Ensure(ctx, pool, s)
	if err != nil {
		return err
	}
	state := func(created bool) string {
		if created {
			return "created"
		}
		return "already existed (unchanged)"
	}
	fmt.Printf("organization %s %s: %s\nfacility %s %s: %s\n",
		s.OrganizationCode, res.OrganizationID, state(res.OrganizationCreated),
		s.FacilityCode, res.FacilityID, state(res.FacilityCreated))
	return nil
}

// bootstrapAdmin makes one staff member the first IAM administrator of the configured organization. The person must
// be an active doctor or employee in the legacy HMS and must have signed in once (so their HMS user exists). It
// refuses when an administrator already exists: afterwards, administrators are managed through the API.
func bootstrapAdmin(ctx context.Context, lookup config.Lookup, args []string) error {
	fs := flag.NewFlagSet("bootstrap-admin", flag.ContinueOnError)
	loginID := fs.String("legacy-user-id", "", "the person's legacy HMS (Khanza) user ID")
	if err := fs.Parse(args); err != nil {
		return err
	}
	if *loginID == "" {
		return errors.New("bootstrap-admin needs -legacy-user-id")
	}
	cfg, err := config.Load(lookup)
	if err != nil {
		return err
	}
	pool, err := openPostgres(ctx, cfg.Database)
	if err != nil {
		return err
	}
	defer pool.Close()
	orgID, _, err := tenancy.Resolve(ctx, pool, cfg.OrganizationCode, cfg.FacilityCode)
	if err != nil {
		return fmt.Errorf("resolve organization: %w", err)
	}
	legacyDB, err := legacyhms.Open(cfg.Legacy)
	if err != nil {
		return err
	}
	defer legacyDB.Close()
	checker, err := legacyhms.NewChecker(legacyhms.QuerierFor(legacyDB),
		[]byte(cfg.LegacyLogin.IDKey.Reveal()), []byte(cfg.LegacyLogin.PasswordKey.Reveal()), cfg.LegacyLogin.EmployeeField)
	if err != nil {
		return err
	}
	ident, err := checker.Resolve(ctx, *loginID)
	if errors.Is(err, legacyhms.ErrInvalid) {
		return errors.New("that user ID is not an active doctor or employee in the legacy HMS")
	}
	if err != nil {
		return fmt.Errorf("legacy HMS: %w", err)
	}
	store := iam.NewPgStore(pool)
	if _, err := store.SyncPermissions(ctx, permissionRegistry(), systemEvent(orgID, "iam.permission.registered")); err != nil {
		return fmt.Errorf("register permissions: %w", err)
	}
	user, found, err := store.FindByIdentity(ctx, ident.Issuer, ident.Subject)
	if err != nil {
		return err
	}
	if !found {
		return errors.New("this person has no HMS user yet: let them sign in once, then run bootstrap-admin again")
	}
	ev := systemEvent(orgID, "iam.role.assigned")
	ev.ResourceType = "RoleAssignment"
	ev.Detail = map[string]string{"user_id": user.ID, "role_code": iam.AdminRole, "tool": "bootstrap-admin"}
	id, err := store.BootstrapAdmin(ctx, orgID, user.ID, ev)
	switch {
	case errors.Is(err, iam.ErrConflict):
		return errors.New("an IAM administrator already exists: grant further administrators through the API")
	case err != nil:
		return err
	}
	fmt.Printf("granted %s to %s (user %s, assignment %s), organization-wide\n", iam.AdminRole, user.DisplayName, user.ID, id)
	return nil
}

// permissionRegistry is every permission this service enforces, across modules.
func permissionRegistry() []iam.PermissionDef {
	all := append([]iam.PermissionDef{}, iam.Registry...)
	all = append(all, clinical.Permissions...)
	all = append(all, tariffs.Permissions...)
	return append(all, assistant.Permissions...)
}

func systemEvent(orgID, action string) audit.Event {
	return audit.Event{Category: audit.CategoryAdministration, Action: action, Outcome: audit.OutcomeSuccess,
		ActorType: audit.ActorSystem, OrganizationID: orgID, Channel: "system"}
}

// checkLegacyKey tests LEGACY_LOGIN_ID_KEY against the legacy user table and reports counts only. The password key
// is not checked here (that would mean decrypting passwords): confirm it with a real sign-in.
func checkLegacyKey(ctx context.Context, lookup config.Lookup) error {
	cfg, err := config.Load(lookup)
	if err != nil {
		return err
	}
	db, err := legacyhms.Open(cfg.Legacy)
	if err != nil {
		return err
	}
	defer db.Close()
	checker, err := legacyhms.NewChecker(legacyhms.QuerierFor(db),
		[]byte(cfg.LegacyLogin.IDKey.Reveal()), []byte(cfg.LegacyLogin.PasswordKey.Reveal()), cfg.LegacyLogin.EmployeeField)
	if err != nil {
		return err
	}
	ctx, cancel := context.WithTimeout(ctx, 2*time.Minute)
	defer cancel()
	r, err := legacyhms.CheckIDKey(ctx, db, checker)
	if err != nil {
		return err
	}
	fmt.Printf("legacy user accounts:              %d\n", r.Accounts)
	fmt.Printf("stored as whole AES blocks:        %d\n", r.BlockAligned)
	fmt.Printf("decoded with LEGACY_LOGIN_ID_KEY:  %d\n", r.Decoded)
	fmt.Printf("decoded with the PASSWORD key:     %d (keys swapped if this is high)\n", r.DecodedSwapped)
	fmt.Printf("re-encrypt equals stored HEX:      %d (what the sign-in query compares)\n", r.ReEncrypted)
	fmt.Printf("  active doctors:                  %d\n", r.ActiveDoctors)
	fmt.Printf("  active employees (via %s): %d\n", cfg.LegacyLogin.EmployeeField, r.ActiveEmployees)
	fmt.Printf("  neither (inactive or other):     %d\n", r.Neither)
	switch {
	case r.Accounts == 0:
		fmt.Println("result: the user table is empty or unreadable by this account")
	case r.Decoded*10 < r.Accounts*9:
		fmt.Println("result: ID KEY IS WRONG (most stored IDs do not decode)")
	default:
		fmt.Println("result: ID key is correct. Confirm the password key with a real sign-in.")
	}
	return nil
}

// checkClinicalRead runs every clinical read statement against the legacy HMS and reports counts only: whether rows
// scan into the expected types and how the values map. It never prints a name, identifier or value.
func checkClinicalRead(ctx context.Context, lookup config.Lookup) error {
	cfg, err := config.Load(lookup)
	if err != nil {
		return err
	}
	db, err := legacyhms.Open(cfg.Legacy)
	if err != nil {
		return err
	}
	defer db.Close()
	ctx, cancel := context.WithTimeout(ctx, 2*time.Minute)
	defer cancel()
	loc, _ := time.LoadLocation("Asia/Jakarta") // offsets only; the check prints no times
	r := legacyhms.NewClinical(legacyhms.RowsQuerierFor(db))

	hits, err := r.SearchPatients(ctx, []string{"a"}, 25)
	if err != nil {
		return fmt.Errorf("patient search: %w", err)
	}
	fmt.Printf("patient search (one common letter, limit 25): %d rows\n", len(hits))
	var profiles, validBirth, nik, phone, encounters, withTime, payerVisits, payers, payersNamed int
	careSettings, statuses := map[string]int{}, map[string]int{}
	for _, h := range hits {
		mrn := clinical.Clean(h.MRN)
		row, err := r.Patient(ctx, mrn)
		if err != nil {
			return fmt.Errorf("patient profile: %w", err)
		}
		p := clinical.MapPatient(row)
		profiles++
		if p.BirthDate != nil {
			validBirth++
		}
		if p.NIK.Masked != "" {
			nik++
		}
		if p.Phone.Masked != "" {
			phone++
		}
		if _, err := r.Identifiers(ctx, mrn); err != nil {
			return fmt.Errorf("identifiers statement: %w", err)
		}
		rows, err := r.PatientEncounters(ctx, mrn, "", 100)
		if err != nil {
			return fmt.Errorf("patient encounters: %w", err)
		}
		for _, er := range rows {
			e := clinical.MapEncounter(er, loc)
			encounters++
			if e.RegisteredAt != nil {
				withTime++
			}
			careSettings[e.CareSetting]++
			code := "(none)"
			if e.Status.Code != nil {
				code = *e.Status.Code // a status value such as "Sudah", not patient data
			}
			statuses[code]++
		}
		visits, err := r.PayerVisits(ctx, mrn, clinical.MaxPayerVisits+1)
		if err != nil {
			return fmt.Errorf("payer visits: %w", err)
		}
		payerVisits += len(visits)
		for _, p := range clinical.MapPayerHistory(mrn, visits, false, loc).Payers {
			payers++
			if p.Name != nil {
				payersNamed++
			}
		}
	}
	fmt.Printf("patient profiles read:             %d (valid birth date %d, NIK recorded %d, phone recorded %d)\n",
		profiles, validBirth, nik, phone)
	fmt.Printf("encounters of those patients:      %d (registration time mapped %d)\n", encounters, withTime)
	fmt.Printf("payer history of those patients:   %d visits, %d payer groups (%d with a penjab name)\n",
		payerVisits, payers, payersNamed)
	fmt.Printf("care settings:                     %v\n", careSettings)
	fmt.Printf("legacy status codes:               %v\n", statuses)
	found, err := r.SearchEncounters(ctx, time.Now().Format("2006/"), 25)
	if err != nil {
		return fmt.Errorf("encounter search: %w", err)
	}
	fmt.Printf("encounter search (this year, limit 25): %d rows\n", len(found))
	if len(found) > 0 {
		if _, err := r.Encounter(ctx, clinical.Clean(found[0].Number)); err != nil {
			return fmt.Errorf("encounter by number: %w", err)
		}
		fmt.Println("encounter by number:               ok")
	}
	if err := checkTimelineRead(ctx, r, found, loc); err != nil {
		return err
	}
	if err := checkTariffRead(ctx, legacyhms.NewTariff(legacyhms.RowsQuerierFor(db))); err != nil {
		return err
	}
	fmt.Println("result: every clinical read statement ran and scanned")
	return nil
}

// checkTimelineRead runs the timeline and bill statements (ADR-SVC-004) for the encounters found and prints counts per
// section, entry type and bill line kind only.
func checkTimelineRead(ctx context.Context, r *legacyhms.Clinical, found []legacyhms.EncounterRow, loc *time.Location) error {
	sections, truncated, entries := map[string]int{}, map[string]int{}, map[string]int{}
	var timelines, undated, bills, saved, receivables, withSEP, seps, bpjsVisits, bpjsWithSEP int
	groups := map[string]int{}
	for _, er := range found {
		number := clinical.Clean(er.Number)
		rows, err := r.Timeline(ctx, number)
		if err != nil {
			return fmt.Errorf("timeline: %w", err)
		}
		timelines++
		for name, rs := range rows.Rows {
			sections[name] += len(rs)
		}
		for _, name := range rows.Truncated {
			truncated[name]++
		}
		tl := clinical.MapTimeline(number, rows, loc)
		for _, e := range tl.Entries {
			entries[e["type"].(string)]++
			if e["at"].(*string) == nil {
				undated++
			}
		}
		sepRows := rows.Rows["sep"] // read by Timeline
		seps += len(sepRows)
		if len(sepRows) > 0 {
			withSEP++
		}
		if strings.EqualFold(tl.Summary.Payer.Code, "BPJ") {
			bpjsVisits++
			if len(sepRows) > 0 {
				bpjsWithSEP++
			}
		}
		rows, err = r.Bill(ctx, number)
		if err != nil {
			return fmt.Errorf("bill: %w", err)
		}
		b := clinical.MapBill(number, rows, loc)
		bills++
		if b.SavedBill != nil {
			saved++
		}
		if b.Receivable != nil {
			receivables++
		}
		for _, g := range b.Groups {
			groups[g.Category] += len(g.Lines)
		}
		for name, rs := range rows.Rows {
			sections[name] += len(rs)
		}
		for _, name := range rows.Truncated {
			truncated[name]++
		}
	}
	fmt.Printf("timelines read:                    %d (entries per type %v, undated %d)\n", timelines, entries, undated)
	fmt.Printf("SEP (bridging_sep):                %d visits with an SEP, %d SEPs; BPJ visits %d, of which with an SEP %d\n",
		withSEP, seps, bpjsVisits, bpjsWithSEP)
	// Recent visits that do have an SEP, so the SEP columns are scanned for real.
	sample, err := r.SEPSample(ctx, 25)
	if err != nil {
		return fmt.Errorf("sep sample: %w", err)
	}
	services, rows, cut, discharged := map[string]int{}, 0, 0, 0
	findings := map[string]int{}
	for _, number := range sample {
		tlRows, err := r.Timeline(ctx, number)
		if err != nil {
			return fmt.Errorf("timeline of an SEP visit: %w", err)
		}
		tl := clinical.MapTimeline(number, tlRows, loc)
		if slices.Contains(tl.Truncated, "sep") {
			cut++
		}
		rows += len(tl.Summary.SEP)
		for _, s := range tl.Summary.SEP {
			if s.ServiceType != nil {
				services[*s.ServiceType]++ // jnspelayanan: a code ('1'/'2'), not patient data
			}
			if s.DischargedAt != nil {
				discharged++
			}
		}
		// What claim readiness would say about the SEP of these visits (rule ids and results only).
		for _, f := range rules.EvaluateClaimReadiness(assistant.VisitOf(tl)).Findings {
			if strings.HasPrefix(f.RuleID, "sep_") {
				findings[f.RuleID+"="+f.Result]++
			}
		}
	}
	fmt.Printf("SEP sample (recent SEPs):          %d visits, %d SEP rows mapped, service types %v, with discharge date %d, capped %d\n",
		len(sample), rows, services, discharged, cut)
	fmt.Printf("SEP checks on that sample:         %v\n", findings)
	fmt.Printf("rows per section (all visits):     %v\n", sections)
	fmt.Printf("sections that hit their cap:       %v\n", truncated)
	fmt.Printf("bills read:                        %d (saved by the cashier %d, with receivable %d, charge lines per category %v)\n",
		bills, saved, receivables, groups)
	return nil
}

// checkTariffRead runs every tariff book statement (ADR-SVC-005) and prints counts only.
func checkTariffRead(ctx context.Context, t *legacyhms.Tariff) error {
	counts := map[string]string{}
	labCode := ""
	for _, k := range legacyhms.TariffKinds {
		rows, err := t.List(ctx, k, legacyhms.TariffFilter{Status: "active", Limit: 100})
		if err != nil {
			return fmt.Errorf("tariff %s: %w", k.Name, err)
		}
		withPrice := 0
		for _, row := range rows {
			it := tariffs.MapItem(k, row)
			if len(it.Prices) > 0 && it.Prices[0].Amount != "" {
				withPrice++
			}
			if k.Name == "laboratory" && labCode == "" {
				labCode = it.Code
			}
		}
		counts[k.Name] = fmt.Sprintf("%d (with a first price %d)", len(rows), withPrice)
	}
	fmt.Printf("tariff book, first page of active items per kind (max 100): %v\n", counts)
	if labCode != "" {
		items, _, err := t.LabItems(ctx, labCode)
		if err != nil {
			return fmt.Errorf("tariff laboratory items: %w", err)
		}
		fmt.Printf("laboratory items of the first test:  %d\n", len(items))
	}
	return nil
}

// checkBillSources compares the bill (charges aggregated from the source tables, ADR-SVC-004) with the cashier's saved
// bill (`billing`) for the most recent saved bills. Per legacy billing category it prints how many visits match to the
// cent with the bill's own formula and with each alternative, which saved categories the bill has no source for, and
// how many grand totals match. Counts and sample-wide sums only: no encounter number, name or single visit's amount is
// printed.
func checkBillSources(ctx context.Context, lookup config.Lookup, args []string) error {
	fs := flag.NewFlagSet("check-bill-sources", flag.ContinueOnError)
	inpatient := fs.Int("inpatient", 50, "number of recent saved inpatient bills to compare (0-500)")
	outpatient := fs.Int("outpatient", 50, "number of recent saved outpatient bills to compare (0-500)")
	if err := fs.Parse(args); err != nil {
		return err
	}
	if *inpatient < 0 || *inpatient > 500 || *outpatient < 0 || *outpatient > 500 {
		return errors.New("-inpatient and -outpatient must be 0-500")
	}
	cfg, err := config.Load(lookup)
	if err != nil {
		return err
	}
	db, err := legacyhms.Open(cfg.Legacy)
	if err != nil {
		return err
	}
	defer db.Close()
	ctx, cancel := context.WithTimeout(ctx, 20*time.Minute)
	defer cancel()
	loc, _ := time.LoadLocation("Asia/Jakarta") // the check prints no times
	reader := legacyhms.NewClinical(legacyhms.RowsQuerierFor(db))
	rc := legacyhms.NewReconciler(legacyhms.RowsQuerierFor(db))

	var categories []string // legacy categories of the bill, in bill order
	billed := map[string]bool{}
	for _, c := range legacyhms.ChargeSections {
		if !billed[c.LegacyCategory] {
			billed[c.LegacyCategory] = true
			categories = append(categories, c.LegacyCategory)
		}
	}
	categories = append(categories, "Service")
	billed["Service"] = true

	type tally struct{ withCharge, match, savedHigher, savedLower int }
	count := func(t *tally, got, want int64) {
		if got == 0 && want == 0 {
			return
		}
		t.withCharge++
		switch {
		case got == want:
			t.match++
		case want > got:
			t.savedHigher++
		default:
			t.savedLower++
		}
	}
	for _, set := range []struct {
		label     string
		inpatient bool
		n         int
	}{{"inpatient", true, *inpatient}, {"outpatient", false, *outpatient}} {
		if set.n == 0 {
			continue
		}
		numbers, err := rc.Sample(ctx, set.inpatient, set.n)
		if err != nil {
			return err
		}
		own, alt := map[string]*tally{}, map[string]*tally{}
		for _, c := range categories {
			own[c] = &tally{}
		}
		absDiff := map[string]int64{}
		uncovered := map[string]int{}
		var merged, compared, truncated int
		totals := &tally{}
		for _, number := range numbers {
			if m, err := rc.Merged(ctx, number); err != nil {
				return err
			} else if m {
				merged++
				continue // their saved bill holds another visit's charges as well
			}
			saved, err := rc.Saved(ctx, number)
			if err != nil {
				return err
			}
			rows, err := reader.Bill(ctx, number)
			if err != nil {
				return fmt.Errorf("bill: %w", err)
			}
			b := clinical.MapBill(number, rows, loc)
			compared++
			if len(b.Truncated) > 0 {
				truncated++
			}
			bySub, byCategory := map[string]int64{}, map[string]int64{}
			for _, g := range b.Groups {
				c, _ := clinical.Cents(g.Subtotal)
				bySub[g.LegacyCategory] += c
				if g.Category != "service" {
					byCategory[g.Category] = c
				}
			}
			for cat, amount := range saved {
				if c, _ := clinical.Cents(amount); c != 0 && !billed[cat] && !strings.HasPrefix(cat, "Ttl") && cat != "Tagihan" {
					uncovered[cat]++
				}
			}
			for _, cat := range categories {
				want, _ := clinical.Cents(saved[cat])
				count(own[cat], bySub[cat], want)
				if d := want - bySub[cat]; d < 0 {
					absDiff[cat] -= d
				} else {
					absDiff[cat] += d
				}
			}
			for _, v := range legacyhms.ReconcileAlternatives {
				parts, err := rc.Amounts(ctx, v, number)
				if err != nil {
					return err
				}
				var got int64
				for _, p := range parts {
					c, _ := clinical.Cents(p)
					got += c
				}
				key := v.LegacyCategory + " | " + v.Name
				if alt[key] == nil {
					alt[key] = &tally{}
				}
				want, _ := clinical.Cents(saved[v.LegacyCategory])
				count(alt[key], got, want)
			}
			if b.CareSetting == "inpatient" { // the other service settings table
				other := "service_settings_receivable"
				if clinical.ServiceSettingsFor(serviceSettingsPayer(rows)) == other {
					other = "service_settings_cash"
				}
				var got int64
				for _, l := range clinical.ServiceLines(byCategory, rows.Rows[other]) {
					c, _ := clinical.Cents(l.Amount)
					got += c
				}
				key := "Service | the other settings table (" + other + ")"
				if alt[key] == nil {
					alt[key] = &tally{}
				}
				want, _ := clinical.Cents(saved["Service"])
				count(alt[key], got, want)
			}
			total, _ := clinical.Cents(b.Total)
			want, _ := clinical.Cents(saved["Tagihan"])
			count(totals, total, want)
		}
		fmt.Printf("== %s: %d recent saved bills, %d compared (%d billed together with another visit, skipped; %d with a capped section)\n",
			set.label, len(numbers), compared, merged, truncated)
		fmt.Println("category | formula: visits with a charge, equal to the cent, saved higher, saved lower")
		for _, cat := range categories {
			t := own[cat]
			fmt.Printf("  %-72s %4d %4d %4d %4d\n", cat+" | as in the bill", t.withCharge, t.match, t.savedHigher, t.savedLower)
		}
		keys := make([]string, 0, len(alt))
		for k := range alt {
			keys = append(keys, k)
		}
		sort.Strings(keys)
		for _, k := range keys {
			t := alt[k]
			fmt.Printf("  %-72s %4d %4d %4d %4d\n", k, t.withCharge, t.match, t.savedHigher, t.savedLower)
		}
		fmt.Println("sum of |saved - bill| over the sample, per category:")
		for _, cat := range categories {
			fmt.Printf("  %-24s %s\n", cat, clinical.FormatCents(absDiff[cat]))
		}
		fmt.Printf("saved categories the bill has no source for (visits with a non-zero amount): %v\n", uncovered)
		fmt.Printf("grand total (bill vs saved Tagihan): %d with a total, %d equal, %d saved higher, %d saved lower\n",
			totals.withCharge, totals.match, totals.savedHigher, totals.savedLower)
	}
	return nil
}

// patterns collects repeated -like flags.
type patterns []string

func (p *patterns) String() string     { return strings.Join(*p, ",") }
func (p *patterns) Set(v string) error { *p = append(*p, v); return nil }

// inventoryLegacySchema writes the legacy schema inventory (metadata only, from information_schema) of the tables
// matching the -like patterns to -out (Markdown). Default patterns: the BPJS bridging and INA-CBG tables.
func inventoryLegacySchema(ctx context.Context, lookup config.Lookup, args []string) error {
	fs := flag.NewFlagSet("inventory-legacy-schema", flag.ContinueOnError)
	var like patterns
	fs.Var(&like, "like", "SQL LIKE pattern of table names (repeatable); default bridging\\_%, inacbg%, %bpjs%")
	out := fs.String("out", "", "Markdown file to write (e.g. ../hms_database/legacy/schema-inventory/bpjs-bridging.md)")
	title := fs.String("title", "Legacy schema inventory: BPJS bridging and INA-CBG tables", "document title")
	if err := fs.Parse(args); err != nil {
		return err
	}
	if *out == "" {
		return errors.New("inventory-legacy-schema needs -out")
	}
	if len(like) == 0 {
		like = patterns{`bridging\_%`, `inacbg%`, `%bpjs%`}
	}
	cfg, err := config.Load(lookup)
	if err != nil {
		return err
	}
	db, err := legacyhms.Open(cfg.Legacy)
	if err != nil {
		return err
	}
	defer db.Close()
	ctx, cancel := context.WithTimeout(ctx, 2*time.Minute)
	defer cancel()
	inv, err := legacyhms.ReadInventory(ctx, legacyhms.RowsQuerierFor(db), like)
	if err != nil {
		return err
	}
	if err := os.WriteFile(*out, []byte(inv.Markdown(*title, time.Now())), 0o644); err != nil {
		return err
	}
	columns := 0
	for _, t := range inv.Tables {
		columns += len(t.Columns)
	}
	fmt.Printf("schema %s: %d tables, %d columns written to %s\n", inv.Schema, len(inv.Tables), columns, *out)
	return nil
}

// serviceSettingsPayer returns the payer type of the visit as the bill sees it (section "encounter").
func serviceSettingsPayer(rows legacyhms.SectionRows) string {
	if e := rows.Rows["encounter"]; len(e) > 0 && len(e[0]) > 1 && e[0][1] != nil {
		return clinical.PayerType(clinical.Clean(e[0][1]))
	}
	return clinical.PayerType("")
}

func openPostgres(ctx context.Context, d config.Database) (*pgxpool.Pool, error) {
	pc, err := pgxpool.ParseConfig(d.PostgresDSN())
	if err != nil {
		return nil, fmt.Errorf("database settings: %w", err)
	}
	pc.ConnConfig.Password = d.Password.Reveal()
	pc.MaxConns = int32(d.MaxConns)
	pool, err := pgxpool.NewWithConfig(ctx, pc)
	if err != nil {
		return nil, fmt.Errorf("database pool: %w", err)
	}
	pingCtx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	if err := pool.Ping(pingCtx); err != nil {
		pool.Close()
		return nil, fmt.Errorf("connect to PostgreSQL %s:%d/%s as %s: %w", d.Host, d.Port, d.Name, d.User, err)
	}
	return pool, nil
}

func newLogger(level string) *slog.Logger {
	var l slog.Level
	_ = l.UnmarshalText([]byte(level))
	return slog.New(slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{Level: l}))
}

// environment combines an optional env file with the process environment (which wins).
func environment(file string) (config.Lookup, error) {
	values := map[string]string{}
	if file != "" {
		f, err := os.Open(file)
		if err != nil {
			return nil, fmt.Errorf("env file: %w", err)
		}
		defer f.Close()
		sc := bufio.NewScanner(f)
		for n := 1; sc.Scan(); n++ {
			line := strings.TrimSpace(sc.Text())
			if line == "" || strings.HasPrefix(line, "#") {
				continue
			}
			k, v, ok := strings.Cut(line, "=")
			if !ok {
				return nil, fmt.Errorf("env file line %d: expected KEY=VALUE", n)
			}
			values[strings.TrimSpace(k)] = strings.Trim(strings.TrimSpace(v), `"`)
		}
		if err := sc.Err(); err != nil {
			return nil, fmt.Errorf("env file: %w", err)
		}
	}
	return func(name string) (string, bool) {
		if v, ok := os.LookupEnv(name); ok {
			return v, true
		}
		v, ok := values[name]
		return v, ok
	}, nil
}
