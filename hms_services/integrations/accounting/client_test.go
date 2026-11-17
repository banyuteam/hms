package accounting

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
	"time"

	"hms/services/core/config"
)

// newTestClient points a client at srv with a fixed token.
func newTestClient(srv *httptest.Server) *Client {
	return NewClient(config.Accounting{
		Enabled: true,
		BaseURL: srv.URL,
		Token:   config.NewSecret("test-token"),
		Timeout: 2 * time.Second,
	})
}

type small struct {
	Total json.Number `json:"total"`
}

func TestGetSendsTokenAndKeepsDigits(t *testing.T) {
	var gotAuth, gotAccept, gotMethod, gotQuery string

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotAuth, gotAccept, gotMethod = r.Header.Get("Authorization"), r.Header.Get("Accept"), r.Method
		gotQuery = r.URL.RawQuery
		// The digits the accounting application actually sends. Decoding this into float64 turns it into
		// 4725470309.579999 — the reason the client asks for json.Number.
		w.Write([]byte(`{"total":4725470309.58}`))
	}))
	defer srv.Close()

	var out small
	if err := newTestClient(srv).Get(context.Background(), "/api/v1/laporan/neraca",
		url.Values{"year": {"2026"}}, &out); err != nil {
		t.Fatalf("get: %v", err)
	}

	if gotMethod != http.MethodGet || gotAuth != "Bearer test-token" || gotAccept != "application/json" {
		t.Errorf("request: %s, auth %q, accept %q", gotMethod, gotAuth, gotAccept)
	}
	if gotQuery != "year=2026" {
		t.Errorf("query: %q", gotQuery)
	}
	if out.Total.String() != "4725470309.58" {
		t.Errorf("digits changed: %s", out.Total)
	}
}

func TestOnlyGetIsAllowed(t *testing.T) {
	// The server fails the test if it is ever reached: the method must be refused before a request is built,
	// not refused by the far side. An accounting application that happens to answer 405 today is not a guarantee.
	srv := httptest.NewServer(http.HandlerFunc(func(http.ResponseWriter, *http.Request) {
		t.Error("upstream was called for a non-GET method")
	}))
	defer srv.Close()

	c := newTestClient(srv)
	for _, method := range []string{http.MethodPost, http.MethodPut, http.MethodDelete, http.MethodPatch} {
		err := c.do(context.Background(), method, "/api/v1/laporan/neraca", nil, &small{})
		if !errors.Is(err, ErrUpstream) || !strings.Contains(err.Error(), "only GET") {
			t.Errorf("%s: %v", method, err)
		}
	}
}

func TestPathMustBeAbsoluteAndHostless(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(http.ResponseWriter, *http.Request) {
		t.Error("upstream was called with a rejected path")
	}))
	defer srv.Close()

	c := newTestClient(srv)
	// A path carrying its own scheme would send the token to whatever host it names.
	for _, path := range []string{"api/v1/laporan/neraca", "http://elsewhere/api", "https://elsewhere/api"} {
		if err := c.Get(context.Background(), path, nil, &small{}); !errors.Is(err, ErrUpstream) {
			t.Errorf("%q: %v", path, err)
		}
	}
}

func TestStatusMapping(t *testing.T) {
	for _, tc := range []struct {
		status int
		want   error
	}{
		{http.StatusUnauthorized, ErrUnauthorized},
		{http.StatusForbidden, ErrUnauthorized},
		{http.StatusNotFound, ErrNotFound},
		{http.StatusInternalServerError, ErrUpstream},
		{http.StatusBadGateway, ErrUpstream},
	} {
		srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
			w.WriteHeader(tc.status)
			w.Write([]byte(`{"message":"SQLSTATE[42S02] at /var/www/app/Services/LaporanService.php:214"}`))
		}))

		err := newTestClient(srv).Get(context.Background(), "/x", nil, &small{})
		if !errors.Is(err, tc.want) {
			t.Errorf("status %d: got %v, want %v", tc.status, err, tc.want)
		}

		// The upstream body can carry its paths, its SQL and its stack traces. None of it belongs in an error
		// that someone will paste into a ticket.
		if strings.Contains(err.Error(), "SQLSTATE") || strings.Contains(err.Error(), "/var/www") {
			t.Errorf("status %d: upstream body leaked into %q", tc.status, err)
		}
		srv.Close()
	}
}

func TestUnknownFieldIsRefused(t *testing.T) {
	// A field this code does not know is a contract change, and a contract change must be loud. Ignoring it is
	// how a renamed field becomes a column of zeroes on screen with nothing to explain it.
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Write([]byte(`{"total":"1","total_baru":"2"}`))
	}))
	defer srv.Close()

	err := newTestClient(srv).Get(context.Background(), "/x", nil, &small{})
	if !errors.Is(err, ErrUpstream) {
		t.Fatalf("unknown field accepted: %v", err)
	}
}

func TestTimeoutIsUpstreamError(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		time.Sleep(300 * time.Millisecond)
		w.Write([]byte(`{"total":"1"}`))
	}))
	defer srv.Close()

	c := NewClient(config.Accounting{
		Enabled: true, BaseURL: srv.URL, Token: config.NewSecret("t"), Timeout: 50 * time.Millisecond,
	})
	if err := c.Get(context.Background(), "/x", nil, &small{}); !errors.Is(err, ErrUpstream) {
		t.Fatalf("timeout: %v", err)
	}
}