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

func TestDocumentsAreOffUnlessConfigured(t *testing.T) {
	c, err := Load(env(nil))
	if err != nil || c.Documents.Enabled {
		t.Fatalf("documents on by default: %+v %v", c.Documents, err)
	}
	if _, err := Load(env(map[string]string{"CLAMAV_ADDR": "clamav:3310"})); err == nil ||
		!strings.Contains(err.Error(), "need DOCUMENTS_DIR") {
		t.Errorf("scanner without a directory: %v", err)
	}
}

func TestDocuments(t *testing.T) {
	c, err := Load(env(map[string]string{"DOCUMENTS_DIR": "/data/assistant-documents", "CLAMAV_ADDR": "clamav:3310",
		"CONVERTER_URL": "http://converter:3000"}))
	if err != nil {
		t.Fatal(err)
	}
	d := c.Documents
	if !d.Enabled || d.ClamAVAddr != "clamav:3310" || d.ConverterURL.Host != "converter:3000" || d.Retention.Hours() != 7*24 {
		t.Errorf("documents %+v", d)
	}
	_, err = Load(env(map[string]string{"DOCUMENTS_DIR": "relative/dir", "CLAMAV_ADDR": "clamav",
		"CONVERTER_URL": "ftp://x", "DOCUMENTS_RETENTION_DAYS": "31"}))
	for _, want := range []string{"DOCUMENTS_DIR must be an absolute path", "CLAMAV_ADDR must be host:port",
		"CONVERTER_URL must be an http(s) URL", "DOCUMENTS_RETENTION_DAYS must be an integer between 1 and 30"} {
		if err == nil || !strings.Contains(err.Error(), want) {
			t.Errorf("missing %q in %v", want, err)
		}
	}
}
