import { createContext, useContext, useMemo, useReducer, type ReactNode } from 'react';
import type { LiveSession } from '@/auth/authApi';
import { demoRoleFor, isDemoAuthEnabled, type Role } from '@/auth/demoAccount';

export type { Role };

/** Display data only; i18n keys so the UI can render it in the active locale. */
export interface SessionUser {
  id: string;
  /**
   * UI hint only — the backend authorizes every request. Live sessions carry permissions instead of a role; until the
   * clinical permissions exist they get the least-privileged UI (`employee`: view only).
   */
  role: Role;
  nameKey: 'user.demo.name' | 'user.demo.employee.name' | 'user.live.name';
  /** The signed-in person's own name (live sign-in); `nameKey` is the fallback label. */
  name?: string;
  roleKey: 'user.demo.role' | 'user.demo.employee.role' | 'user.live.staff';
  /** Permission codes in force at the session facility (live only; demo users have none). UI hint only. */
  permissions: readonly string[];
  /** Facility of the live session (scope of "this facility" grants); null for demo users. */
  facilityId: string | null;
}

export type LogoutReason = 'user' | 'idle' | 'expired';
export type LoginResult = { ok: true } | { ok: false; reason: 'required' | 'invalid' | 'disabled' };

/** DEMO session state. In memory only — no localStorage/sessionStorage/cookies (CLAUDE.md §5, §9). Not authentication. */
export interface AuthState {
  user: SessionUser | null;
  /** Why the last session ended, to show a notice on the login screen. */
  notice: LogoutReason | null;
}

export type AuthAction =
  | { type: 'auth/signedIn'; user: SessionUser }
  | { type: 'auth/signedOut'; reason: LogoutReason | null };

export const initialAuthState: AuthState = { user: null, notice: null };

export function authReducer(_state: AuthState, action: AuthAction): AuthState {
  switch (action.type) {
    case 'auth/signedIn':
      return { user: action.user, notice: null };
    case 'auth/signedOut':
      return { user: null, notice: action.reason };
  }
}

export function demoUser(role: Role): SessionUser {
  return role === 'doctor'
    ? {
        id: 'demo-user',
        role,
        nameKey: 'user.demo.name',
        roleKey: 'user.demo.role',
        permissions: [],
        facilityId: null,
      }
    : {
        id: 'demo-employee',
        role,
        nameKey: 'user.demo.employee.name',
        roleKey: 'user.demo.employee.role',
        permissions: [],
        facilityId: null,
      };
}

export function liveUser(session: LiveSession): SessionUser {
  return {
    id: session.userId,
    role: 'employee',
    nameKey: 'user.live.name',
    roleKey: 'user.live.staff',
    permissions: session.permissions,
    facilityId: session.facilityId,
    ...(session.displayName ? { name: session.displayName } : {}),
  };
}

/** The name to show for a session user: their own name when known, else the localized label. */
export function displayName(user: SessionUser, t: (id: string) => string): string {
  return user.name ?? t(user.nameKey);
}

export interface AuthActions {
  /** Demo account check (static, public credentials). Returns why it failed; the form shows the message. */
  login: (username: string, password: string) => LoginResult;
  /** Live sign-in: name and permissions come from the hms_services session; the server still authorizes every call. */
  loginLive: (session: LiveSession) => void;
  /** Use `useEndSession()` instead, so the other session state is wiped too. */
  clear: (reason: LogoutReason | null) => void;
}

const AuthStateContext = createContext<AuthState | null>(null);
const AuthActionsContext = createContext<AuthActions | null>(null);

export function AuthProvider({
  children,
  initialState = initialAuthState,
}: {
  children: ReactNode;
  initialState?: AuthState;
}) {
  const [state, dispatch] = useReducer(authReducer, initialState);
  const actions = useMemo<AuthActions>(
    () => ({
      login: (username, password) => {
        if (!isDemoAuthEnabled()) return { ok: false, reason: 'disabled' };
        if (!username.trim() || !password) return { ok: false, reason: 'required' };
        const role = demoRoleFor(username, password);
        if (!role) return { ok: false, reason: 'invalid' };
        dispatch({ type: 'auth/signedIn', user: demoUser(role) });
        return { ok: true };
      },
      loginLive: (session) => dispatch({ type: 'auth/signedIn', user: liveUser(session) }),
      clear: (reason) => dispatch({ type: 'auth/signedOut', reason }),
    }),
    [],
  );
  return (
    <AuthActionsContext.Provider value={actions}>
      <AuthStateContext.Provider value={state}>{children}</AuthStateContext.Provider>
    </AuthActionsContext.Provider>
  );
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthStateContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}

export function useAuthActions(): AuthActions {
  const ctx = useContext(AuthActionsContext);
  if (!ctx) throw new Error('useAuthActions must be used inside <AuthProvider>');
  return ctx;
}

/** UI role. Signed out → `employee` (least privilege). UI hint only: the backend authorizes every call. */
export function useRole(): Role {
  return useAuth().user?.role ?? 'employee';
}

/** Whether the session holds `code` (live sessions only). Shapes the UI; the server authorizes every request. */
export function usePermission(code: string): boolean {
  return useAuth().user?.permissions.includes(code) ?? false;
}

/** Doctor-only edit affordances: a UI preview (nothing is saved), so development builds only. */
export function useCanEdit(): boolean {
  return useRole() === 'doctor' && import.meta.env.DEV;
}

/** Locale key of the "what this role can do here" pill (Home and dock): a doctor is view-only where editing is off. */
export function useRoleLabelKey():
  | 'emr.role.doctor'
  | 'emr.role.doctorView'
  | 'emr.role.employee'
  | 'emr.role.live' {
  const { user } = useAuth();
  const role = useRole();
  const canEdit = useCanEdit();
  // Live sessions have permissions, not a doctor/employee role: a neutral label, view only until clinical permissions.
  if (user?.roleKey === 'user.live.staff') return 'emr.role.live';
  if (role === 'employee') return 'emr.role.employee';
  return canEdit ? 'emr.role.doctor' : 'emr.role.doctorView';
}
