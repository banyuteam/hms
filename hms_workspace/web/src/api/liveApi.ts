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

/**
 * `status` 0 = the request never reached the server (network down, hms-services not running). `details` carries the
 * machine-readable extras some contracts add to the error envelope (`error.reason`, a top-level `problems` list).
 */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    readonly requestId?: string,
    readonly details?: ErrorDetails,
  ) {
    super(`${status} ${code}`);
    this.name = 'ApiError';
  }
}

/** The server answered, but not in the contract's shape (thrown by the response mappers): a data problem, not an outage. */
export function isBadShape(e: unknown): boolean {
  return e instanceof ApiError && e.code === 'BAD_SHAPE';
}

export interface ErrorDetails {
  /** `error.reason`, e.g. why an uploaded file was refused. */
  reason?: string;
  /** Top-level `problems` of a refused batch (e.g. a catalogue import), as sent. */
  problems?: unknown;
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

  const { code, requestId, details } = await readError(res);
  if (res.status === 401) onUnauthorized?.();
  throw new ApiError(res.status, code, requestId, details);
}

/**
 * The hms_services error envelope `{error:{code,message}}` with the request id in `X-Request-ID`; anything else (a proxy
 * page) keeps a generic code. The server's message is not used: the UI shows its own localized text per code.
 */
export async function readError(
  res: Response,
): Promise<{ code: string; requestId?: string; details?: ErrorDetails }> {
  const requestId = res.headers.get('X-Request-ID') ?? undefined;
  try {
    const body = (await res.json()) as {
      error?: { code?: unknown; reason?: unknown };
      problems?: unknown;
    };
    const details: ErrorDetails = {};
    if (typeof body.error?.reason === 'string') details.reason = body.error.reason;
    if (body.problems !== undefined) details.problems = body.problems;
    return {
      code: typeof body.error?.code === 'string' ? body.error.code : 'UPSTREAM',
      requestId,
      ...(Object.keys(details).length ? { details } : {}),
    };
  } catch {
    return { code: 'UPSTREAM', requestId };
  }
}

/**
 * A state-changing request (POST/PUT/PATCH/DELETE) with a JSON body. Resolves the parsed answer, or `undefined` for
 * 204. Never retried automatically: the caller shows the error and the person decides.
 */
export async function liveSend<T>(
  method: 'POST' | 'PUT' | 'PATCH' | 'DELETE',
  path: string,
  body?: unknown,
  query?: Query,
): Promise<T | undefined> {
  let res: Response;
  try {
    res = await fetch(`${API_ROOT}${path}${queryString(query)}`, {
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
  const { code, requestId, details } = await readError(res);
  if (res.status === 401) onUnauthorized?.();
  throw new ApiError(res.status, code, requestId, details);
}

function queryString(query?: Query): string {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(query ?? {})) if (v !== undefined) qs.set(k, String(v));
  return qs.size ? `?${qs}` : '';
}

/** Uploads take longer than JSON calls (up to 20 MiB on a hospital network). */
const UPLOAD_TIMEOUT_MS = 120_000;

/**
 * Uploads one file as `multipart/form-data` (one part, `file`) with PUT. The browser sends the file's name in the part
 * header; hms_services never reads or stores it. Never retried automatically.
 */
export async function liveUpload<T>(path: string, file: Blob, query?: Query): Promise<T | undefined> {
  const form = new FormData();
  form.append('file', file);
  let res: Response;
  try {
    res = await fetch(`${API_ROOT}${path}${queryString(query)}`, {
      method: 'PUT',
      headers: { Accept: 'application/json' },
      body: form,
      credentials: 'same-origin',
      cache: 'no-store',
      signal: AbortSignal.timeout(UPLOAD_TIMEOUT_MS),
    });
  } catch {
    throw new ApiError(0, 'NETWORK');
  }
  if (res.ok) return res.status === 204 ? undefined : ((await res.json()) as T);
  const { code, requestId, details } = await readError(res);
  if (res.status === 401) onUnauthorized?.();
  throw new ApiError(res.status, code, requestId, details);
}

/** Same-origin URL of an API resource (a file download or an image), for a link or an <img>. */
export const apiUrl = (path: string, query?: Query): string => `${API_ROOT}${path}${queryString(query)}`;

/** Path segment for an id such as a `no_rawat` (`2026/10/26/000123` → `%2F`). */
export const seg = (id: string): string => encodeURIComponent(id);
