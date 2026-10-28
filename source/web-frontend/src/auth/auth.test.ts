import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { checkDemoCredentials, getDemoAccount } from './demoAccount';
import { useAuthStore } from './authStore';
import { endSession } from './session';
import { useIdleLogout } from './useIdleLogout';
import { useWindowStore } from '@/workspace/windowStore';

beforeEach(() => {
  useAuthStore.setState({ user: null, notice: null });
  useWindowStore.getState().reset();
});

describe('static demo account', () => {
  it('is disabled unless VITE_DEMO_AUTH=true — no account, no login', () => {
    vi.stubEnv('VITE_DEMO_AUTH', 'false');
    expect(getDemoAccount()).toBeNull();
    expect(checkDemoCredentials('demo.dokter', 'Demo#2026')).toBe(false);
    expect(useAuthStore.getState().login('demo.dokter', 'Demo#2026')).toEqual({
      ok: false,
      reason: 'disabled',
    });
    expect(useAuthStore.getState().user).toBeNull();
  });

  it('logs in with the demo credentials only', () => {
    vi.stubEnv('VITE_DEMO_AUTH', 'true');
    const { login } = useAuthStore.getState();
    expect(login('', '')).toEqual({ ok: false, reason: 'required' });
    expect(login('demo.dokter', 'salah')).toEqual({ ok: false, reason: 'invalid' });
    expect(login('lain', 'Demo#2026')).toEqual({ ok: false, reason: 'invalid' });
    expect(useAuthStore.getState().user).toBeNull();
    expect(login(' demo.dokter ', 'Demo#2026')).toEqual({ ok: true });
    expect(useAuthStore.getState().user?.id).toBe('demo-user');
  });

  it('keeps the session in memory only (nothing in web storage)', () => {
    vi.stubEnv('VITE_DEMO_AUTH', 'true');
    useAuthStore.getState().login('demo.dokter', 'Demo#2026');
    expect(window.localStorage.length).toBe(0);
    expect(window.sessionStorage.length).toBe(0);
  });

  it('logout clears the session and the window layout, and records why', () => {
    vi.stubEnv('VITE_DEMO_AUTH', 'true');
    useAuthStore.getState().login('demo.dokter', 'Demo#2026');
    useWindowStore.getState().open('patients');
    endSession('user');
    expect(useAuthStore.getState().user).toBeNull();
    expect(useAuthStore.getState().notice).toBe('user');
    expect(useWindowStore.getState().windows).toHaveLength(0);
  });
});

describe('idle logout', () => {
  it('fires after the idle period and is postponed by activity', () => {
    vi.useFakeTimers();
    const onIdle = vi.fn();
    const { unmount } = renderHook(() => useIdleLogout(1, onIdle));
    act(() => {
      vi.advanceTimersByTime(50_000);
    });
    act(() => {
      vi.setSystemTime(Date.now() + 2000);
      window.dispatchEvent(new Event('keydown'));
    });
    act(() => {
      vi.advanceTimersByTime(50_000);
    });
    expect(onIdle).not.toHaveBeenCalled();
    act(() => {
      vi.advanceTimersByTime(15_000);
    });
    expect(onIdle).toHaveBeenCalledTimes(1);
    unmount();
    vi.useRealTimers();
  });
});
