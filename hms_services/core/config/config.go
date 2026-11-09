// Package config parses the bootstrap configuration of hms-services from the environment into typed values and
// validates it at startup (runtime-config-control-plane skill). Secrets may be given as NAME or as NAME_FILE (a
// mounted file); they are wrapped in Secret so they never appear in logs or error messages.
package config

import (
	"errors"
	"fmt"
	"net"
	"net/netip"
	"net/url"
	"os"
	"regexp"
	"strconv"
	"strings"
	"time"
)

// Secret holds secret material; its String form is redacted.
type Secret struct{ value string }

func NewSecret(v string) Secret               { return Secret{value: v} }
func (s Secret) Reveal() string               { return s.value }
func (s Secret) IsSet() bool                  { return s.value != "" }
func (s Secret) String() string               { return "[redacted]" }
func (s Secret) GoString() string             { return "[redacted]" }
func (s Secret) MarshalText() ([]byte, error) { return []byte("[redacted]"), nil }

type Env string

const (
	Development Env = "development"
	Test        Env = "test"
	Production  Env = "production"
)

type Database struct {
	Host     string
	Port     int
	Name     string
	User     string
	Password Secret
	SSLMode  string
	MaxConns int
}

type LegacyDatabase struct {
	Host     string
	Port     int
	Name     string
	User     string
	Password Secret
	Timeout  time.Duration
	MaxConns int
}

// LegacyLogin holds the two AES keys the legacy HMS (Khanza) uses for user.id_user and user.password, and the
// pegawai column that legacy user IDs hold for employees.
type LegacyLogin struct {
	IDKey         Secret
	PasswordKey   Secret
	EmployeeField string
}

type Session struct {
	Idle           time.Duration
	Absolute       time.Duration
	ActiveCacheTTL time.Duration // how long a "still active in the legacy HMS" answer is reused
}

type SignIn struct {
	LockoutFailures int
	LockoutWindow   time.Duration
	LockoutDuration time.Duration
	PerIPPerMinute  int
}

// Documents configures uploaded-document handling (ADR-SVC-009). Off unless DOCUMENTS_DIR is set; then the scanner and
// the converter are required too.
type Documents struct {
	Enabled      bool
	Dir          string
	ClamAVAddr   string // host:port of clamd
	ConverterURL *url.URL
	Retention    time.Duration // how long a file stays on the volume (D-7: 7 days; at most 30, as the database enforces)
}

type Config struct {
	Env              Env
	HTTPAddr         string
	PublicOrigin     *url.URL
	TrustedProxies   []netip.Prefix
	LogLevel         string
	OrganizationCode string
	FacilityCode     string
	Database         Database
	Legacy           LegacyDatabase
	LegacyLogin      LegacyLogin
	Session          Session
	SignIn           SignIn
	Documents        Documents
}

// Lookup reads one variable; os.LookupEnv in production, a map in tests.
type Lookup func(name string) (string, bool)

var (
	identifier = regexp.MustCompile(`^[A-Za-z_][A-Za-z0-9_]{0,63}$`)
	code       = regexp.MustCompile(`^[A-Z0-9][A-Z0-9_-]{0,31}$`)
)

// Load reads and validates the configuration. Every problem is reported, not just the first.
func Load(get Lookup) (*Config, error) {
	p := parser{get: get}
	c := &Config{
		Env:              Env(p.str("APP_ENV", "development")),
		HTTPAddr:         p.str("HTTP_ADDR", "127.0.0.1:8080"),
		LogLevel:         strings.ToLower(p.str("LOG_LEVEL", "info")),
		OrganizationCode: p.required("HMS_ORGANIZATION_CODE"),
		FacilityCode:     p.required("HMS_FACILITY_CODE"),
		Database:         p.database(),
		Legacy: LegacyDatabase{
			Host:     p.required("LEGACY_DB_HOST"),
			Port:     p.integer("LEGACY_DB_PORT", 3306, 1, 65535),
			Name:     p.required("LEGACY_DB_NAME"),
			User:     p.required("LEGACY_DB_USER"),
			Password: p.secret("LEGACY_DB_PASSWORD", true),
			Timeout:  time.Duration(p.integer("LEGACY_DB_TIMEOUT_SECONDS", 5, 1, 60)) * time.Second,
			MaxConns: p.integer("LEGACY_DB_MAX_CONNS", 5, 1, 20),
		},
		LegacyLogin: LegacyLogin{
			IDKey:         p.secret("LEGACY_LOGIN_ID_KEY", true),
			PasswordKey:   p.secret("LEGACY_LOGIN_PASSWORD_KEY", true),
			EmployeeField: p.str("LEGACY_LOGIN_EMPLOYEE_FIELD", "nik"),
		},
		Session: Session{
			Idle:           time.Duration(p.integer("SESSION_IDLE_MINUTES", 15, 1, 240)) * time.Minute,
			Absolute:       time.Duration(p.integer("SESSION_ABSOLUTE_HOURS", 12, 1, 24)) * time.Hour,
			ActiveCacheTTL: time.Duration(p.integer("LEGACY_ACTIVE_CACHE_SECONDS", 300, 0, 900)) * time.Second,
		},
		SignIn: SignIn{
			LockoutFailures: p.integer("SIGNIN_LOCKOUT_FAILURES", 5, 3, 20),
			LockoutWindow:   time.Duration(p.integer("SIGNIN_LOCKOUT_WINDOW_MINUTES", 15, 1, 120)) * time.Minute,
			LockoutDuration: time.Duration(p.integer("SIGNIN_LOCKOUT_MINUTES", 15, 1, 240)) * time.Minute,
			PerIPPerMinute:  p.integer("SIGNIN_RATE_PER_MINUTE", 20, 1, 600),
		},
	}

	c.Documents = p.documents()

	switch c.Env {
	case Development, Test, Production:
	default:
		p.fail("APP_ENV must be development, test or production")
	}
	switch c.LogLevel {
	case "debug", "info", "warn", "error":
	default:
		p.fail("LOG_LEVEL must be debug, info, warn or error")
	}
	if c.OrganizationCode != "" && !code.MatchString(c.OrganizationCode) {
		p.fail("HMS_ORGANIZATION_CODE must match " + code.String())
	}
	if c.FacilityCode != "" && !code.MatchString(c.FacilityCode) {
		p.fail("HMS_FACILITY_CODE must match " + code.String())
	}
	if !identifier.MatchString(c.LegacyLogin.EmployeeField) {
		p.fail("LEGACY_LOGIN_EMPLOYEE_FIELD must be a plain column name")
	}
	origin := p.required("PUBLIC_ORIGIN")
	if origin != "" {
		u, err := url.Parse(origin)
		if err != nil || (u.Scheme != "http" && u.Scheme != "https") || u.Host == "" || (u.Path != "" && u.Path != "/") ||
			u.RawQuery != "" || u.Fragment != "" || u.User != nil {
			p.fail("PUBLIC_ORIGIN must be an origin such as https://hms.example.org (scheme and host only)")
		} else {
			u.Path = ""
			c.PublicOrigin = u
		}
	}
	for _, s := range splitList(p.str("TRUSTED_PROXIES", "")) {
		prefix, err := netip.ParsePrefix(s)
		if err != nil {
			addr, err2 := netip.ParseAddr(s)
			if err2 != nil {
				p.fail("TRUSTED_PROXIES entries must be IP addresses or CIDR ranges")
				continue
			}
			prefix = netip.PrefixFrom(addr, addr.BitLen())
		}
		c.TrustedProxies = append(c.TrustedProxies, prefix)
	}

	// Production hardening: no plain-HTTP origin, no unverified database TLS.
	if c.Env == Production {
		if c.PublicOrigin != nil && c.PublicOrigin.Scheme != "https" {
			p.fail("PUBLIC_ORIGIN must use https in production")
		}
		if c.Database.SSLMode != "verify-full" && c.Database.SSLMode != "verify-ca" {
			p.fail("DATABASE_SSLMODE must be verify-full or verify-ca in production")
		}
	}
	if len(p.problems) > 0 {
		return nil, errors.New("invalid configuration:\n  " + strings.Join(p.problems, "\n  "))
	}
	return c, nil
}

func (p *parser) documents() Documents {
	d := Documents{Dir: p.str("DOCUMENTS_DIR", "")}
	addr, conv := p.str("CLAMAV_ADDR", ""), p.str("CONVERTER_URL", "")
	if d.Dir == "" {
		if addr != "" || conv != "" {
			p.fail("CLAMAV_ADDR and CONVERTER_URL need DOCUMENTS_DIR")
		}
		return d
	}
	d.Enabled = true
	if !strings.HasPrefix(d.Dir, "/") && !(len(d.Dir) > 2 && d.Dir[1] == ':') {
		p.fail("DOCUMENTS_DIR must be an absolute path")
	}
	if _, port, err := net.SplitHostPort(addr); err != nil || port == "" {
		p.fail("CLAMAV_ADDR must be host:port")
	}
	d.ClamAVAddr = addr
	u, err := url.Parse(conv)
	if err != nil || (u.Scheme != "http" && u.Scheme != "https") || u.Host == "" || u.User != nil {
		p.fail("CONVERTER_URL must be an http(s) URL")
	} else {
		d.ConverterURL = u
	}
	d.Retention = time.Duration(p.integer("DOCUMENTS_RETENTION_DAYS", 7, 1, 30)) * 24 * time.Hour
	return d
}

// LoadDatabase reads only the DATABASE_* settings, for commands that need nothing else.
func LoadDatabase(get Lookup) (Database, error) {
	p := parser{get: get}
	d := p.database()
	if len(p.problems) > 0 {
		return Database{}, errors.New("invalid configuration:\n  " + strings.Join(p.problems, "\n  "))
	}
	return d, nil
}

func (p *parser) database() Database {
	d := Database{
		Host:     p.str("DATABASE_HOST", "127.0.0.1"),
		Port:     p.integer("DATABASE_PORT", 5432, 1, 65535),
		Name:     p.str("DATABASE_NAME", "hms"),
		User:     p.str("DATABASE_USER", "hms_meta_runtime"),
		Password: p.secret("DATABASE_PASSWORD", true),
		SSLMode:  p.str("DATABASE_SSLMODE", "prefer"),
		MaxConns: p.integer("DATABASE_MAX_CONNS", 10, 1, 50),
	}
	switch d.SSLMode {
	case "disable", "allow", "prefer", "require", "verify-ca", "verify-full":
	default:
		p.fail("DATABASE_SSLMODE is not a PostgreSQL sslmode")
	}
	return d
}

// SecureCookies reports whether the session cookie is HTTPS-only (always, unless the origin is plain HTTP in
// development).
func (c *Config) SecureCookies() bool { return c.PublicOrigin.Scheme == "https" }

// PostgresDSN builds the runtime connection string. The password is passed separately by the caller.
func (d Database) PostgresDSN() string {
	u := url.URL{
		Scheme:   "postgres",
		User:     url.User(d.User),
		Host:     fmt.Sprintf("%s:%d", d.Host, d.Port),
		Path:     "/" + d.Name,
		RawQuery: url.Values{"sslmode": {d.SSLMode}, "application_name": {"hms-services"}}.Encode(),
	}
	return u.String()
}

type parser struct {
	get      Lookup
	problems []string
}

func (p *parser) fail(msg string) { p.problems = append(p.problems, msg) }

func (p *parser) str(name, def string) string {
	if v, ok := p.get(name); ok && strings.TrimSpace(v) != "" {
		return strings.TrimSpace(v)
	}
	return def
}

func (p *parser) required(name string) string {
	v := p.str(name, "")
	if v == "" {
		p.fail(name + " is required")
	}
	return v
}

func (p *parser) integer(name string, def, min, max int) int {
	v := p.str(name, "")
	if v == "" {
		return def
	}
	n, err := strconv.Atoi(v)
	if err != nil || n < min || n > max {
		p.fail(fmt.Sprintf("%s must be an integer between %d and %d", name, min, max))
		return def
	}
	return n
}

// secret reads NAME or NAME_FILE (not both). File contents are used without the trailing newline.
func (p *parser) secret(name string, required bool) Secret {
	direct, hasDirect := p.get(name)
	file, hasFile := p.get(name + "_FILE")
	hasDirect = hasDirect && direct != ""
	hasFile = hasFile && strings.TrimSpace(file) != ""
	switch {
	case hasDirect && hasFile:
		p.fail(name + " and " + name + "_FILE are both set; use one")
		return Secret{}
	case hasFile:
		b, err := os.ReadFile(strings.TrimSpace(file))
		if err != nil {
			p.fail(name + "_FILE cannot be read")
			return Secret{}
		}
		v := strings.TrimRight(string(b), "\r\n")
		if v == "" && required {
			p.fail(name + "_FILE is empty")
		}
		return Secret{value: v}
	case hasDirect:
		return Secret{value: direct}
	}
	if required {
		p.fail(name + " or " + name + "_FILE is required")
	}
	return Secret{}
}

func splitList(s string) []string {
	var out []string
	for _, part := range strings.Split(s, ",") {
		if part = strings.TrimSpace(part); part != "" {
			out = append(out, part)
		}
	}
	return out
}
