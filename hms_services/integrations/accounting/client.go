// Package accounting reads the accounting application (akutansi-rsb2) over HTTP: ADR-SVC-014. It is the first
// outward HTTP call in hms_services — everything here is a pattern the next integration will copy.
//
// Read-only in layers, the same discipline as integrations/legacyhms: the accounting application exposes no write
// endpoint, this client refuses any method but GET before a request is built, and the token it carries belongs to
// an account that holds only the seven View: permissions.
package accounting

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"

	"hms/services/core/config"
)

// Errors the caller distinguishes. The upstream response body is never part of them: it can carry the accounting
// application's own stack traces, hosts and SQL, and those must not reach a log that someone will paste into a
// ticket, let alone the browser.
var (
	ErrUnauthorized = errors.New("accounting: token refused")
	ErrNotFound     = errors.New("accounting: not found")
	ErrUpstream     = errors.New("accounting: upstream failed")
)

// maxBody caps what is read from the accounting application. A balance sheet is tens of kilobytes; the general
// ledger of one account in a busy month is larger but still far below this. The cap exists so that a confused or
// hostile upstream cannot exhaust memory here.
const maxBody = 8 << 20

type Client struct {
	base  string
	token config.Secret
	http  *http.Client
}

func NewClient(cfg config.Accounting) *Client {
	return &Client{
		base:  cfg.BaseURL,
		token: cfg.Token,
		http: &http.Client{
			Timeout: cfg.Timeout,
			Transport: &http.Transport{
				MaxIdleConnsPerHost: 4,
				IdleConnTimeout:     30 * time.Second,
			},
		},
	}
}

// Get reads one report into out. Path is joined to the configured base URL; it must be absolute and must not
// contain a scheme or host of its own.
func (c *Client) Get(ctx context.Context, path string, q url.Values, out any) error {
	return c.do(ctx, http.MethodGet, path, q, out)
}

// do is where the GET-only rule lives, and it is a method parameter rather than a hard-coded verb so that the rule
// is something a test can try to break. Nothing else in this package calls it with anything but GET.
func (c *Client) do(ctx context.Context, method, path string, q url.Values, out any) error {
	if method != http.MethodGet {
		return fmt.Errorf("%w: only GET is allowed, not %s", ErrUpstream, method)
	}
	if !strings.HasPrefix(path, "/") || strings.Contains(path, "://") {
		return fmt.Errorf("%w: path must be absolute and without a host", ErrUpstream)
	}

	target := c.base + path
	if len(q) > 0 {
		target += "?" + q.Encode()
	}

	req, err := http.NewRequestWithContext(ctx, method, target, nil)
	if err != nil {
		return fmt.Errorf("%w: %v", ErrUpstream, err)
	}
	req.Header.Set("Authorization", "Bearer "+c.token.Reveal())
	req.Header.Set("Accept", "application/json")

	resp, err := c.http.Do(req)
	if err != nil {
		// The URL is in err and the URL holds the host, but never the token: Go redacts neither, so the caller
		// logs this and answers 503 without it.
		return fmt.Errorf("%w: %v", ErrUpstream, err)
	}
	defer func() {
		_, _ = io.Copy(io.Discard, io.LimitReader(resp.Body, maxBody))
		resp.Body.Close()
	}()

	switch {
	case resp.StatusCode == http.StatusUnauthorized, resp.StatusCode == http.StatusForbidden:
		// Our service token, not the signed-in person: HMS already decided this person may read. Separate from
		// ErrUpstream because it needs a human to rotate or re-grant something, not a retry.
		return ErrUnauthorized
	case resp.StatusCode == http.StatusNotFound:
		return ErrNotFound
	case resp.StatusCode != http.StatusOK:
		return fmt.Errorf("%w: status %d", ErrUpstream, resp.StatusCode)
	}

	dec := json.NewDecoder(io.LimitReader(resp.Body, maxBody))

	// Amounts pass through as their original digits. The accounting application sends JSON numbers, and decoding
	// money into float64 would turn 4725470309.58 into 4725470309.579999 — which is what its own PHP does when a
	// total is encoded without care. json.Number keeps the text exactly as sent and re-encodes it unchanged.
	dec.UseNumber()

	// A field this code does not know is a contract change, and a contract change must be loud (ADR-SVC-014
	// Decision 7). Silently ignoring it is how a renamed field becomes a column of zeroes on screen.
	dec.DisallowUnknownFields()

	if err := dec.Decode(out); err != nil {
		return fmt.Errorf("%w: response did not match the expected shape: %v", ErrUpstream, err)
	}
	return nil
}