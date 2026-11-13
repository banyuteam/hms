package config

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func env(over map[string]string) Lookup {
	base := map[string]string{
		"HMS_ORGANIZATION_CODE": "RSUB2", "HMS_FACILITY_CODE": "RSUB2-MAIN", "PUBLIC_ORIGIN": "http://127.0.0.1:5173",
		"DATABASE_PASSWORD": "db-secret", "LEGACY_DB_HOST": "legacy.test.invalid", "LEGACY_DB_NAME": "khanza",
		"LEGACY_DB_USER": "readonly", "LEGACY_DB_PASSWORD": "legacy-secret",
		"LEGACY_LOGIN_ID_KEY": "id-key", "LEGACY_LOGIN_PASSWORD_KEY": "pw-key",
	}
	for k, v := range over {
		if v == "-" {
			delete(base, k)
		} else {
			base[k] = v
		}
	}
	return func(n string) (string, bool) { v, ok := base[n]; return v, ok }
}

func TestDefaults(t *testing.T) {
	c, err := Load(env(nil))
	if err != nil {
		t.Fatal(err)
	}
	if c.Env != Development || c.Database.User != "hms_meta_runtime" || c.Session.Idle.Minutes() != 15 ||
		c.LegacyLogin.EmployeeField != "nik" || c.SecureCookies() {
		t.Errorf("unexpected defaults: %+v", c)
	}
}

func TestReportsEveryProblem(t *testing.T) {
	_, err := Load(env(map[string]string{"LEGACY_DB_HOST": "-", "LEGACY_LOGIN_ID_KEY": "-", "SESSION_IDLE_MINUTES": "0",
		"PUBLIC_ORIGIN": "https://hms.example/path", "LEGACY_LOGIN_EMPLOYEE_FIELD": "nik; DROP"}))
	if err == nil {
		t.Fatal("expected errors")
	}
	for _, want := range []string{"LEGACY_DB_HOST", "LEGACY_LOGIN_ID_KEY", "SESSION_IDLE_MINUTES", "PUBLIC_ORIGIN", "LEGACY_LOGIN_EMPLOYEE_FIELD"} {
		if !strings.Contains(err.Error(), want) {
			t.Errorf("missing %s in %v", want, err)
		}
	}
}

func TestProductionHardening(t *testing.T) {
	_, err := Load(env(map[string]string{"APP_ENV": "production"}))
	if err == nil || !strings.Contains(err.Error(), "https") || !strings.Contains(err.Error(), "DATABASE_SSLMODE") {
		t.Errorf("production must require https and verified TLS: %v", err)
	}
	if _, err := Load(env(map[string]string{"APP_ENV": "production", "PUBLIC_ORIGIN": "https://hms.example",
		"DATABASE_SSLMODE": "verify-full"})); err != nil {
		t.Errorf("hardened production config refused: %v", err)
	}
}

func TestSecretFilesAndRedaction(t *testing.T) {
	path := filepath.Join(t.TempDir(), "key")
	if err := os.WriteFile(path, []byte("from-file\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	c, err := Load(env(map[string]string{"LEGACY_LOGIN_ID_KEY": "-", "LEGACY_LOGIN_ID_KEY_FILE": path}))
	if err != nil {
		t.Fatal(err)
	}
	if c.LegacyLogin.IDKey.Reveal() != "from-file" {
		t.Errorf("file secret = %q", c.LegacyLogin.IDKey.Reveal())
	}
	for _, s := range []string{fmt.Sprint(c.LegacyLogin), fmt.Sprintf("%+v", c), fmt.Sprintf("%#v", c.Database.Password)} {
		if strings.Contains(s, "from-file") || strings.Contains(s, "db-secret") || strings.Contains(s, "pw-key") {
			t.Errorf("secret leaked in %s", s)
		}
	}
	if _, err := Load(env(map[string]string{"LEGACY_LOGIN_ID_KEY_FILE": path})); err == nil {
		t.Error("NAME and NAME_FILE together must be refused")
	}
}

func TestBridgeConfiguration(t *testing.T) {
	get := func(over map[string]string) Lookup {
		base := map[string]string{"HMS_ORGANIZATION_CODE": "RSUB2", "HMS_FACILITY_CODE": "RSUB2-MAIN", "DATABASE_PASSWORD": "bridge-secret",
			"LEGACY_DB_HOST": "legacy.test.invalid", "LEGACY_DB_NAME": "khanza", "LEGACY_DB_USER": "readonly", "LEGACY_DB_PASSWORD": "legacy-secret"}
		for k, v := range over {
			if v == "-" {
				delete(base, k)
			} else {
				base[k] = v
			}
		}
		return func(n string) (string, bool) { v, ok := base[n]; return v, ok }
	}
	b, err := LoadBridge(get(nil))
	if err != nil {
		t.Fatal(err)
	}
	// The bridge needs no HTTP, session or legacy sign-in settings, and connects as its own login by default.
	if b.Database.User != "hms_meta_legacy_bridge" || b.Batch != 500 || b.Pause.Milliseconds() != 1000 || b.Interval.Seconds() != 300 ||
		b.Legacy.MaxConns != 2 {
		t.Errorf("unexpected bridge defaults: %+v", b)
	}
	_, err = LoadBridge(get(map[string]string{"LEGACY_DB_PASSWORD": "-", "BRIDGE_BATCH_SIZE": "9000", "APP_ENV": "production"}))
	for _, want := range []string{"LEGACY_DB_PASSWORD", "BRIDGE_BATCH_SIZE", "DATABASE_SSLMODE"} {
		if err == nil || !strings.Contains(err.Error(), want) {
			t.Errorf("expected a problem about %s, got %v", want, err)
		}
	}
}

func TestFiles(t *testing.T) {
	c, err := Load(env(nil))
	if err != nil || c.Files.Enabled || c.Files.MaxBytes != 20<<20 {
		t.Fatalf("files off by default: %+v, %v", c.Files, err)
	}
	c, err = Load(env(map[string]string{"FILES_DIR": "/data/files", "CLAMAV_ADDR": "clamav:3310", "FILES_MAX_MB": "10"}))
	if err != nil || !c.Files.Enabled || c.Files.ClamAVAddr != "clamav:3310" || c.Files.MaxBytes != 10<<20 {
		t.Fatalf("files on: %+v, %v", c.Files, err)
	}
	for name, over := range map[string]map[string]string{
		"scanner required":  {"FILES_DIR": "/data/files"},
		"scanner needs dir": {"CLAMAV_ADDR": "clamav:3310"},
		"relative dir":      {"FILES_DIR": "data/files", "CLAMAV_ADDR": "clamav:3310"},
		"size cap":          {"FILES_DIR": "/data/files", "CLAMAV_ADDR": "clamav:3310", "FILES_MAX_MB": "21"},
		"scanner host:port": {"FILES_DIR": "/data/files", "CLAMAV_ADDR": "clamav"},
	} {
		if _, err := Load(env(over)); err == nil {
			t.Errorf("%s: accepted", name)
		}
	}
}
