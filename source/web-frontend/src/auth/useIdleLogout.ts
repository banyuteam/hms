import { useEffect } from 'react';

const ACTIVITY_EVENTS = ['pointerdown', 'pointermove', 'keydown', 'wheel', 'touchstart'] as const;

/** Calls `onIdle` after `minutes` without user activity. Demo stand-in for the auto-lock (OQ-12). */
export function useIdleLogout(minutes: number, onIdle: () => void, enabled = true): void {
  useEffect(() => {
    if (!enabled || !Number.isFinite(minutes) || minutes <= 0) return undefined;
    let timer: ReturnType<typeof setTimeout>;
    let last = 0;
    const arm = () => {
      clearTimeout(timer);
      timer = setTimeout(onIdle, minutes * 60_000);
    };
    const onActivity = () => {
      const now = Date.now();
      if (now - last < 1000) return; // throttle noisy events
      last = now;
      arm();
    };
    arm();
    ACTIVITY_EVENTS.forEach((e) => window.addEventListener(e, onActivity, { passive: true }));
    return () => {
      clearTimeout(timer);
      ACTIVITY_EVENTS.forEach((e) => window.removeEventListener(e, onActivity));
    };
  }, [minutes, onIdle, enabled]);
}

export function idleMinutes(): number {
  const raw = Number(import.meta.env.VITE_IDLE_MINUTES ?? 15);
  return Number.isFinite(raw) && raw > 0 ? raw : 15;
}
