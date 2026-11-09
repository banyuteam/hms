/**
 * Live data from hms_services: the browser talks only to its own origin (`/api/v1/*`, proxied in development) and holds
 * only an HttpOnly session cookie it cannot read. Nothing about the session is stored in the browser: no token, no
 * storage, no URL. State-changing requests are protected by the server's Origin check.
 *
 * The data source is a build choice (`VITE_DATA_SOURCE=bff`), never guessed at runtime, so the app cannot silently fall
 * back to synthetic data when the server is unreachable.
 */
export function isLiveApi(): boolean {
  return import.meta.env.VITE_DATA_SOURCE === 'bff';
}

const API_ROOT = '/api/v1';
const TIMEOUT_MS = 30_000;

let onUnauthorized: (() => void) | null = null;

/** Called when the server answers 401 (session ended, expired, or the person is no longer active): the app signs out. */
export function setUnauthorizedHandler(handler: (() => void) | null): void {
  onUnauthorized = handler;
}

/** `status` 0 = the request never reached the server (network down, hms-services not running). */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    readonly requestId?: string,
  ) {
    super(`${status} ${code}`);
    this.name = 'ApiError';
  }
}

/** The server answered, but not in the contract's shape (thrown by the response mappers): a data problem, not an outage. */
export function isBadShape(e: unknown): boolean {
  return e instanceof ApiError && e.code === 'BAD_SHAPE';
}

export type Query = Record<string, string | number | undefined>;

export async function liveGet<T>(path: string, query?: Query): Promise<T> {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(query ?? {})) if (v !== undefined) qs.set(k, String(v));
  const url = `${API_ROOT}${path}${qs.size ? `?${qs}` : ''}`;

  let res: Response;
  try {
    res = await fetch(url, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      // The session cookie goes to our own origin only, never cross-site.
      credentials: 'same-origin',
      cache: 'no-store',
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    throw new ApiError(0, 'NETWORK');
  }

  if (res.ok) return (await res.json()) as T;

  const { code, requestId } = await readError(res);
  if (res.status === 401) onUnauthorized?.();
  throw new ApiError(res.status, code, requestId);
}

/**
 * The hms_services error envelope `{error:{code,message}}` with the request id in `X-Request-ID`; anything else (a proxy
 * page) keeps a generic code. The server's message is not used: the UI shows its own localized text per code.
 */
export async function readError(res: Response): Promise<{ code: string; requestId?: string }> {
  const requestId = res.headers.get('X-Request-ID') ?? undefined;
  try {
    const body = (await res.json()) as { error?: { code?: unknown } };
    return { code: typeof body.error?.code === 'string' ? body.error.code : 'UPSTREAM', requestId };
  } catch {
    return { code: 'UPSTREAM', requestId };
  }
}

/**
 * A state-changing request (POST/PUT/PATCH) with a JSON body. Resolves the parsed answer, or `undefined` for 204. Never
 * retried automatically: the caller shows the error and the person decides.
 */
export async function liveSend<T>(
  method: 'POST' | 'PUT' | 'PATCH',
  path: string,
  body?: unknown,
): Promise<T | undefined> {
  let res: Response;
  try {
    res = await fetch(`${API_ROOT}${path}`, {
      method,
      headers: {
        Accept: 'application/json',
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      credentials: 'same-origin',
      cache: 'no-store',
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    throw new ApiError(0, 'NETWORK');
  }
  if (res.ok) return res.status === 204 ? undefined : ((await res.json()) as T);
  const { code, requestId } = await readError(res);
  if (res.status === 401) onUnauthorized?.();
  throw new ApiError(res.status, code, requestId);
}

/** Path segment for an id such as a `no_rawat` (`2026/10/26/000123` → `%2F`). */
export const seg = (id: string): string => encodeURIComponent(id);
