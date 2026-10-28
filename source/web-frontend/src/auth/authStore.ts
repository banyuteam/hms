import { create } from 'zustand';
import { checkDemoCredentials, isDemoAuthEnabled } from './demoAccount';

/** Display data only; i18n keys so the UI can render it in the active locale. */
export interface SessionUser {
  id: string;
  nameKey: 'user.demo.name';
  roleKey: 'user.demo.role';
}

export type LogoutReason = 'user' | 'idle';
export type LoginResult = { ok: true } | { ok: false; reason: 'required' | 'invalid' | 'disabled' };

interface AuthState {
  /** In memory only — no localStorage/sessionStorage/cookies (PHI & security rules). */
  user: SessionUser | null;
  /** Why the last session ended, to show a notice on the login screen. */
  notice: LogoutReason | null;
  login: (username: string, password: string) => LoginResult;
  /** Use `endSession()` from `session.ts` so other stores are cleared too. */
  clear: (reason: LogoutReason | null) => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  notice: null,
  login: (username, password) => {
    if (!isDemoAuthEnabled()) return { ok: false, reason: 'disabled' };
    if (!username.trim() || !password) return { ok: false, reason: 'required' };
    if (!checkDemoCredentials(username, password)) return { ok: false, reason: 'invalid' };
    set({
      user: { id: 'demo-user', nameKey: 'user.demo.name', roleKey: 'user.demo.role' },
      notice: null,
    });
    return { ok: true };
  },
  clear: (reason) => set({ user: null, notice: reason }),
}));
