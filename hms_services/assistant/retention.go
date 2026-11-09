package assistant

import (
	"context"
	"log/slog"
	"time"
)

// Purger deletes expired assistant data (PgStore; documents.Retention).
type Purger interface {
	Purge(ctx context.Context, now time.Time) (PurgeResult, error)
}

const (
	retentionFirstRun = time.Minute
	retentionTimeout  = 5 * time.Minute
)

// RunRetention runs every purger a minute after start and then every `every`, until ctx ends. Several replicas may run
// it: each batch deletes only rows that are still there, so concurrent runs are harmless. One failing purger does not
// stop the others.
func RunRetention(ctx context.Context, every time.Duration, logger *slog.Logger, purgers ...Purger) {
	timer := time.NewTimer(retentionFirstRun)
	defer timer.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-timer.C:
		}
		for _, p := range purgers {
			runCtx, cancel := context.WithTimeout(ctx, retentionTimeout)
			res, err := p.Purge(runCtx, time.Now())
			cancel()
			if err != nil {
				logger.Error("assistant retention failed", "err", err)
			} else {
				logger.Info("assistant retention", "deleted", res)
			}
		}
		timer.Reset(every)
	}
}
