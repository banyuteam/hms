package httpx

import (
	"sync"
	"time"
)

// WindowLimiter allows n events per key per fixed window. Per process: with several replicas the effective limit
// multiplies, so the ingress must also rate-limit (documented in the README).
type WindowLimiter struct {
	mu     sync.Mutex
	n      int
	window time.Duration
	now    func() time.Time
	start  time.Time
	counts map[string]int
}

func NewWindowLimiter(n int, window time.Duration, now func() time.Time) *WindowLimiter {
	return &WindowLimiter{n: n, window: window, now: now, start: now(), counts: map[string]int{}}
}

// Allow counts one event for key and reports whether it is within the limit.
func (l *WindowLimiter) Allow(key string) bool {
	l.mu.Lock()
	defer l.mu.Unlock()
	if now := l.now(); now.Sub(l.start) >= l.window {
		l.start, l.counts = now, map[string]int{}
	}
	l.counts[key]++
	return l.counts[key] <= l.n
}
