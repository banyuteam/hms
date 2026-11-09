import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { AppProviders } from '@/AppProviders';
import {
  authReducer,
  demoUser,
  initialAuthState,
  liveUser,
  useAuth,
  useAuthActions,
} from '@/state/auth';
import { useHome, useHomeActions } from '@/state/home';
import { useEndSession } from '@/state/session';
import { checkDemoCredentials, getDemoAccount } from './demoAccount';
import { useIdleLogout } from './useIdleLogout';

const wrapper = ({ children }: { children: ReactNode }) => <AppProviders>{children}</AppProviders>;

function useSession() {
  return {
    auth: useAuth(),
    actions: useAuthActions(),
    home: useHome(),
    homeActions: useHomeActions(),
    endSession: useEndSession(),
  };
}

beforeEach(() => {
  window.localStorage.clear();
  window.sessionStorage.clear();
});

describe('authReducer', () => {
  it('signs in (clearing any notice) and signs out with a reason', () => {
    const signedIn = authReducer(
      { user: null, notice: 'idle' },
      { type: 'auth/signedIn', user: demoUser('doctor') },
    );
    expect(signedIn).toEqual({ user: demoUser('doctor'), notice: null });
    expect(authReducer(signedIn, { type: 'auth/signedOut', reason: 'expired' })).toEqual({
      user: null,
      notice: 'expired',
    });
  });

  it('builds the demo and live users with role-specific labels', () => {
    expect(demoUser('employee')).toMatchObject({ id: 'demo-employee', role: 'employee' });
    const live = liveUser({
      userId: '01a1ba10-0000-7000-8000-000000000001',
      displayName: 'dr. Test',
      organizationId: 'org',
      facilityId: 'fac',
      expiresAt: '2026-11-08T20:00:00Z',
      permissions: ['iam.users.read'],
    });
    // Live sessions carry permissions, not a role: least-privileged UI until clinical permissions exist.
    expect(live).toMatchObject({
      id: '01a1ba10-0000-7000-8000-000000000001',
      role: 'employee',
      roleKey: 'user.live.staff',
      name: 'dr. Test',
      permissions: ['iam.users.read'],
    });
    expect(demoUser('doctor').permissions).toEqual([]);
    expect(initialAuthState).toEqual({ user: null, notice: null });
  });
});

describe('static demo account', () => {
  it('is disabled unless VITE_DEMO_AUTH=true — no account, no login', () => {
    vi.stubEnv('VITE_DEMO_AUTH', 'false');
    expect(getDemoAccount()).toBeNull();
    expect(checkDemoCredentials('demo.dokter', 'Demo#2026')).toBe(false);
    const { result } = renderHook(useSession, { wrapper });
    let res: unknown;
    act(() => {
      res = result.current.actions.login('demo.dokter', 'Demo#2026');
    });
    expect(res).toEqual({ ok: false, reason: 'disabled' });
    expect(result.current.auth.user).toBeNull();
  });

  it('logs in with the demo credentials only', () => {
    vi.stubEnv('VITE_DEMO_AUTH', 'true');
    const { result } = renderHook(useSession, { wrapper });
    const login = (u: string, p: string) => {
      let res: unknown;
      act(() => {
        res = result.current.actions.login(u, p);
      });
      return res;
    };
    expect(login('', '')).toEqual({ ok: false, reason: 'required' });
    expect(login('demo.dokter', 'salah')).toEqual({ ok: false, reason: 'invalid' });
    expect(login('lain', 'Demo#2026')).toEqual({ ok: false, reason: 'invalid' });
    expect(result.current.auth.user).toBeNull();
    expect(login(' demo.dokter ', 'Demo#2026')).toEqual({ ok: true });
    expect(result.current.auth.user?.id).toBe('demo-user');
    expect(login('demo.perawat', 'Demo#2026')).toEqual({ ok: true });
    expect(result.current.auth.user?.role).toBe('employee');
  });

  it('keeps the session in memory only (nothing in web storage)', () => {
    vi.stubEnv('VITE_DEMO_AUTH', 'true');
    const { result } = renderHook(useSession, { wrapper });
    act(() => {
      result.current.actions.login('demo.dokter', 'Demo#2026');
    });
    expect(window.localStorage.length).toBe(0);
    expect(window.sessionStorage.length).toBe(0);
  });

  it('ending the session clears the user and the window layout, and records why', () => {
    vi.stubEnv('VITE_DEMO_AUTH', 'true');
    const { result } = renderHook(useSession, { wrapper });
    act(() => {
      result.current.actions.login('demo.dokter', 'Demo#2026');
    });
    act(() => result.current.homeActions.open('emr-records'));
    expect(result.current.home.windows).toHaveLength(1);
    act(() => result.current.endSession('user'));
    expect(result.current.auth.user).toBeNull();
    expect(result.current.auth.notice).toBe('user');
    expect(result.current.home.windows).toHaveLength(0);
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
