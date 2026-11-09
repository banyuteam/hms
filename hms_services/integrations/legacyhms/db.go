package legacyhms

import (
	"context"
	"database/sql"
	"database/sql/driver"
	"errors"
	"fmt"
	"net"
	"strconv"
	"strings"
	"time"

	"github.com/go-sql-driver/mysql"

	"hms/services/core/config"
)

// Open builds a lazily connecting pool to the legacy HMS. Every connection is put into a read-only session before
// use, and statements are time-limited where the server supports it. It never writes: the account must also be
// SELECT-only (standards/security/legacy-read-only-policy.md).
func Open(cfg config.LegacyDatabase) (*sql.DB, error) {
	mc := mysql.NewConfig()
	mc.Net = "tcp"
	mc.Addr = net.JoinHostPort(cfg.Host, strconv.Itoa(cfg.Port))
	mc.User = cfg.User
	mc.Passwd = cfg.Password.Reveal()
	mc.DBName = cfg.Name
	mc.Timeout = cfg.Timeout
	mc.ReadTimeout = cfg.Timeout
	mc.WriteTimeout = cfg.Timeout
	inner, err := mysql.NewConnector(mc)
	if err != nil {
		return nil, fmt.Errorf("legacy database connector: %w", err)
	}
	db := sql.OpenDB(&readOnlyConnector{inner: inner, timeout: cfg.Timeout})
	db.SetMaxOpenConns(cfg.MaxConns)
	db.SetMaxIdleConns(cfg.MaxConns)
	db.SetConnMaxLifetime(30 * time.Minute)
	return db, nil
}

type readOnlyConnector struct {
	inner   driver.Connector
	timeout time.Duration
}

func (c *readOnlyConnector) Driver() driver.Driver { return c.inner.Driver() }

func (c *readOnlyConnector) Connect(ctx context.Context) (driver.Conn, error) {
	conn, err := c.inner.Connect(ctx)
	if err != nil {
		return nil, err
	}
	ex, ok := conn.(driver.ExecerContext)
	if !ok {
		_ = conn.Close()
		return nil, errors.New("legacy driver connection cannot run session setup")
	}
	if _, err := ex.ExecContext(ctx, "SET SESSION TRANSACTION READ ONLY", nil); err != nil {
		_ = conn.Close()
		return nil, fmt.Errorf("legacy read-only session: %w", err)
	}
	// MariaDB: max_statement_time (seconds); MySQL: max_execution_time (milliseconds). Best effort: one of them fails.
	secs := strconv.FormatFloat(c.timeout.Seconds(), 'f', -1, 64)
	if _, err := ex.ExecContext(ctx, "SET SESSION max_statement_time = "+secs, nil); err != nil {
		_, _ = ex.ExecContext(ctx, "SET SESSION max_execution_time = "+strconv.FormatInt(c.timeout.Milliseconds(), 10), nil)
	}
	return conn, nil
}

// QuerierFor adapts a *sql.DB to Querier, mapping sql.ErrNoRows to ErrNoRows.
func QuerierFor(db *sql.DB) Querier { return sqlQuerier{db: db} }

type sqlQuerier struct{ db *sql.DB }

func (q sqlQuerier) QueryRow(ctx context.Context, query string, args ...any) Row {
	if !strings.HasPrefix(query, "SELECT ") {
		return errRow{err: errors.New("legacyhms: only SELECT statements are allowed")}
	}
	return sqlRow{row: q.db.QueryRowContext(ctx, query, args...)}
}

type sqlRow struct{ row *sql.Row }

func (r sqlRow) Scan(dest ...any) error {
	err := r.row.Scan(dest...)
	if errors.Is(err, sql.ErrNoRows) {
		return ErrNoRows
	}
	return err
}

type errRow struct{ err error }

func (r errRow) Scan(...any) error { return r.err }
