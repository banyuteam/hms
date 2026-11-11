import { useCallback, useEffect, useRef, useState } from 'react';

const ACTIVITY_EVENTS = ['pointerdown', 'pointermove', 'keydown', 'wheel', 'touchstart'] as const;

/** How long before the idle sign-out the warning shows: a minute, or half the period when that is shorter. */
export function warningSeconds(minutes: number): number {
  return Math.min(60, Math.floor((minutes * 60) / 2));
}

export interface IdleState {
  /** The warning is showing: the session ends in `secondsLeft` unless the user stays. */
  warning: boolean;
  secondsLeft: number;
  /** Keeps the session (WCAG 2.2.1: the user is warned and can extend with one simple action). */
  stay: () => void;
}

/**
 * Calls `onIdle` after `minutes` without user activity, and warns first (`warning`, `secondsLeft`) so the person can stay
 * signed in. Any activity (or `stay`) restarts the period. Demo stand-in for the auto-lock (timeout: hospital decision
 * pending).
 */
export function useIdleLogout(minutes: number, onIdle: () => void, enabled = true): IdleState {
  const [deadline, setDeadline] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const rearm = useRef<() => void>(() => {});

  useEffect(() => {
    if (!enabled || !Number.isFinite(minutes) || minutes <= 0) return undefined;
    const total = minutes * 60_000;
    const warnMs = warningSeconds(minutes) * 1000;
    let idleTimer: ReturnType<typeof setTimeout>;
    let warnTimer: ReturnType<typeof setTimeout>;
    let last = 0;
    const arm = () => {
      clearTimeout(idleTimer);
      clearTimeout(warnTimer);
      setDeadline(null);
      const end = Date.now() + total;
      warnTimer = setTimeout(() => {
        setNow(Date.now());
        setDeadline(end);
      }, total - warnMs);
      idleTimer = setTimeout(() => {
        setDeadline(null);
        onIdle();
      }, total);
    };
    const onActivity = () => {
      const t = Date.now();
      if (t - last < 1000) return; // throttle noisy events
      last = t;
      arm();
    };
    rearm.current = arm;
    arm();
    ACTIVITY_EVENTS.forEach((e) => window.addEventListener(e, onActivity, { passive: true }));
    return () => {
      clearTimeout(idleTimer);
      clearTimeout(warnTimer);
      rearm.current = () => {};
      ACTIVITY_EVENTS.forEach((e) => window.removeEventListener(e, onActivity));
    };
  }, [minutes, onIdle, enabled]);

  // The countdown ticks only while the warning shows.
  useEffect(() => {
    if (deadline === null) return undefined;
    const tick = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(tick);
  }, [deadline]);

  const stay = useCallback(() => rearm.current(), []);
  return {
    warning: deadline !== null,
    secondsLeft: deadline === null ? 0 : Math.max(0, Math.ceil((deadline - now) / 1000)),
    stay,
  };
}

export function idleMinutes(): number {
  const raw = Number(import.meta.env.VITE_IDLE_MINUTES ?? 15);
  return Number.isFinite(raw) && raw > 0 ? raw : 15;
}
