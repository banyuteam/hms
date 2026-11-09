package assistant

import (
	"context"
	"log/slog"
	"time"
)

// Purger deletes expired assistant rows (PgStore).
type Purger interface {
	Purge(ctx context.Context, now time.Time) (PurgeResult, error)
}

const (
	retentionFirstRun = time.Minute
	retentionTimeout  = 5 * time.Minute
)

// RunRetention purges expired assistant data a minute after start and then every `every`, until ctx ends. Several
// replicas may run it: each batch deletes only rows that are still there, so concurrent runs are harmless.
func RunRetention(ctx context.Context, p Purger, every time.Duration, logger *slog.Logger) {
	timer := time.NewTimer(retentionFirstRun)
	defer timer.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-timer.C:
		}
		runCtx, cancel := context.WithTimeout(ctx, retentionTimeout)
		res, err := p.Purge(runCtx, time.Now())
		cancel()
		if err != nil {
			logger.Error("assistant retention failed", "err", err)
		} else {
			logger.Info("assistant retention", "deleted", map[string]int64(res))
		}
		timer.Reset(every)
	}
}
