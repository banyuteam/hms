// Package httpx holds HTTP plumbing shared by all hms-services APIs: request IDs, security headers, access logging,
// panic recovery, client address resolution and the JSON error format.
package httpx

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"log/slog"
	"net"
	"net/http"
	"net/netip"
	"regexp"
	"strings"
	"time"
)

type ctxKey int

const requestIDKey ctxKey = iota

var requestIDPattern = regexp.MustCompile(`^[A-Za-z0-9._-]{8,64}$`)

// RequestID returns the request's correlation ID.
func RequestID(ctx context.Context) string {
	id, _ := ctx.Value(requestIDKey).(string)
	return id
}

// ErrorBody is the error format of every endpoint: {"error": {"code": "...", "message": "..."}}.
type ErrorBody struct {
	Error struct {
		Code    string `json:"code"`
		Message string `json:"message"`
	} `json:"error"`
}

func WriteJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

// WriteError writes a stable code and a safe message; never internal details.
func WriteError(w http.ResponseWriter, status int, code, message string) {
	var b ErrorBody
	b.Error.Code, b.Error.Message = code, message
	WriteJSON(w, status, b)
}

// Middleware wraps every request: recovery, request ID, security headers and one access log line (no query strings,
// bodies, cookies or user identifiers).
func Middleware(logger *slog.Logger, next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()
		id := r.Header.Get("X-Request-ID")
		if !requestIDPattern.MatchString(id) {
			b := make([]byte, 12)
			_, _ = rand.Read(b)
			id = hex.EncodeToString(b)
		}
		h := w.Header()
		h.Set("X-Request-ID", id)
		h.Set("Cache-Control", "no-store")
		h.Set("X-Content-Type-Options", "nosniff")
		h.Set("X-Frame-Options", "DENY")
		h.Set("Referrer-Policy", "no-referrer")
		h.Set("Content-Security-Policy", "default-src 'none'; frame-ancestors 'none'")
		rec := &statusRecorder{ResponseWriter: w, status: http.StatusOK}
		defer func() {
			if p := recover(); p != nil {
				logger.Error("panic in handler", "request_id", id, "panic", p)
				WriteError(rec, http.StatusInternalServerError, "internal_error", "Internal error.")
			}
			logger.Info("http request", "request_id", id, "method", r.Method, "path", r.URL.Path,
				"status", rec.status, "duration_ms", time.Since(start).Milliseconds())
		}()
		next.ServeHTTP(rec, r.WithContext(context.WithValue(r.Context(), requestIDKey, id)))
	})
}

type statusRecorder struct {
	http.ResponseWriter
	status int
}

func (s *statusRecorder) WriteHeader(code int) {
	s.status = code
	s.ResponseWriter.WriteHeader(code)
}

// ClientAddr returns the caller's IP. X-Real-IP is honoured only when the TCP peer is a trusted proxy.
func ClientAddr(r *http.Request, trusted []netip.Prefix) string {
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		host = r.RemoteAddr
	}
	peer, err := netip.ParseAddr(host)
	if err != nil {
		return ""
	}
	peer = peer.Unmap()
	for _, p := range trusted {
		if p.Contains(peer) {
			if real, err := netip.ParseAddr(strings.TrimSpace(r.Header.Get("X-Real-IP"))); err == nil {
				return real.Unmap().String()
			}
			break
		}
	}
	return peer.String()
}
