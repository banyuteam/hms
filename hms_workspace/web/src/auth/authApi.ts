/**
 * Sign-in, session and sign-out against hms_services (contract `hms_services/contracts/api/auth-v1.openapi.yaml`,
 * ADR-SVC-001). Staff sign in with their own Khanza user ID and password; hms_services checks them read-only against the
 * legacy HMS. The session is an HttpOnly, SameSite=Strict cookie this code never sees. State-changing requests are
 * protected by the server's Origin check (same-origin `fetch` always sends it), so no token is held in the browser.
 *
 * Every wrong ID, wrong password or inactive person gets the same `invalid` answer from the server, on purpose.
 */
export interface LiveSession {
  userId: string;
  /** Display only. */
  displayName: string;
  organizationId: string;
  facilityId: string | null;
  /** Absolute expiry (ISO 8601); the server also ends idle sessions. */
  expiresAt: string;
  /** Permission codes in force at the session facility. A UI hint only: the server authorizes every request. */
  permissions: readonly string[];
}

export type SignInResult =
  | { ok: true; session: LiveSession }
  | { ok: false; reason: 'invalid' | 'disabled' | 'rate' | 'unavailable' };

const AUTH_ROOT = '/api/v1/auth';
const TIMEOUT_MS = 30_000;
const MAX_PERMISSIONS = 500;

interface SessionBody {
  user?: { id?: unknown; display_name?: unknown };
  organization_id?: unknown;
  facility_id?: unknown;
  expires_at?: unknown;
  permissions?: unknown;
}

/** Validates the server's session answer; anything unexpected is treated as "unavailable", never as signed in. */
export function toSession(body: SessionBody): LiveSession | null {
  const id = body.user?.id;
  const name = body.user?.display_name;
  if (
    typeof id !== 'string' ||
    !id ||
    typeof name !== 'string' ||
    typeof body.organization_id !== 'string' ||
    typeof body.expires_at !== 'string' ||
    !Array.isArray(body.permissions)
  ) {
    return null;
  }
  const permissions = body.permissions
    .filter((p): p is string => typeof p === 'string' && p.length <= 128)
    .slice(0, MAX_PERMISSIONS);
  const trimmed = name.trim();
  return {
    userId: id,
    displayName: trimmed.length <= 200 ? trimmed : trimmed.slice(0, 200),
    organizationId: body.organization_id,
    facilityId: typeof body.facility_id === 'string' && body.facility_id ? body.facility_id : null,
    expiresAt: body.expires_at,
    permissions,
  };
}

async function call(path: string, init: RequestInit): Promise<Response | null> {
  try {
    return await fetch(`${AUTH_ROOT}${path}`, {
      ...init,
      credentials: 'same-origin',
      cache: 'no-store',
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    return null;
  }
}

async function errorCode(res: Response): Promise<string | null> {
  try {
    const body = (await res.json()) as { error?: { code?: unknown } };
    return typeof body.error?.code === 'string' ? body.error.code : null;
  } catch {
    return null;
  }
}

export async function signIn(userId: string, password: string): Promise<SignInResult> {
  const res = await call('/sign-in', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ user_id: userId.trim(), password }),
  });
  if (!res) return { ok: false, reason: 'unavailable' };
  if (res.status === 400 || res.status === 401) return { ok: false, reason: 'invalid' };
  if (res.status === 429) return { ok: false, reason: 'rate' };
  if (res.status === 403) {
    // account_disabled: the person is suspended in HMS. origin_not_allowed is a deployment problem, not the user's.
    return (await errorCode(res)) === 'account_disabled'
      ? { ok: false, reason: 'disabled' }
      : { ok: false, reason: 'unavailable' };
  }
  if (!res.ok) return { ok: false, reason: 'unavailable' };
  try {
    const session = toSession((await res.json()) as SessionBody);
    return session ? { ok: true, session } : { ok: false, reason: 'unavailable' };
  } catch {
    return { ok: false, reason: 'unavailable' };
  }
}

/**
 * The current session, if the browser still has one (a page reload keeps the cookie). `null` = not signed in;
 * `'unavailable'` = the server could not be asked, which the caller must not treat as signed in.
 */
export async function fetchSession(): Promise<LiveSession | null | 'unavailable'> {
  const res = await call('/session', { method: 'GET', headers: { Accept: 'application/json' } });
  if (!res) return 'unavailable';
  if (res.status === 401) return null;
  if (!res.ok) return 'unavailable';
  try {
    return toSession((await res.json()) as SessionBody) ?? 'unavailable';
  } catch {
    return 'unavailable';
  }
}

/**
 * Ends the server-side session. Best effort: the local session is wiped regardless, and if this request is lost the
 * server still ends the session at its idle timeout.
 */
export async function signOut(): Promise<void> {
  await call('/sign-out', { method: 'POST' });
}
