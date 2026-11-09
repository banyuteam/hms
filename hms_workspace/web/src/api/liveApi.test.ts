import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, isLiveApi, liveGet, seg, setUnauthorizedHandler } from './liveApi';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
  setUnauthorizedHandler(null);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  setUnauthorizedHandler(null);
});

describe('isLiveApi', () => {
  it('is on only for VITE_DATA_SOURCE=bff, in dev and in production builds alike', () => {
    expect(isLiveApi()).toBe(false);
    vi.stubEnv('VITE_DATA_SOURCE', 'bff');
    expect(isLiveApi()).toBe(true);
    vi.stubEnv('DEV', false);
    expect(isLiveApi()).toBe(true); // a production build served with hms_services is live
    vi.stubEnv('VITE_DATA_SOURCE', 'BFF');
    expect(isLiveApi()).toBe(false); // exact value only
  });
});

describe('liveGet', () => {
  it('sends a same-origin GET with no Authorization header (the session is an HttpOnly cookie) and builds the query', async () => {
    fetchMock.mockResolvedValue(json({ data: [] }));
    await liveGet('/patients', { limit: 5, sort: '-no_rawat', skip: undefined });
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('/api/v1/patients?limit=5&sort=-no_rawat');
    expect(init).toMatchObject({ method: 'GET', credentials: 'same-origin', cache: 'no-store' });
    expect(init.headers).toEqual({ Accept: 'application/json' });
  });

  it('on 401 tells the app (which ends the session) and exposes the code', async () => {
    const handler = vi.fn();
    setUnauthorizedHandler(handler);
    // hms_services error envelope: {error:{code,message}}, request id in the X-Request-ID header.
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ error: { code: 'unauthenticated', message: 'x' } }), {
        status: 401,
        headers: { 'Content-Type': 'application/json', 'X-Request-ID': 'r1' },
      }),
    );
    await expect(liveGet('/patients')).rejects.toMatchObject({
      status: 401,
      code: 'unauthenticated',
      requestId: 'r1',
    });
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('does not end the session on other errors and exposes the error code', async () => {
    const handler = vi.fn();
    setUnauthorizedHandler(handler);
    for (const [status, code] of [
      [400, 'INVALID_SEARCH'],
      [429, 'RATE_LIMITED'],
      [504, 'UPSTREAM_TIMEOUT'],
    ] as const) {
      fetchMock.mockResolvedValueOnce(
        json({ error: { code, message: 'x', request_id: 'r2' } }, status),
      );
      await expect(liveGet('/patients')).rejects.toMatchObject({ status, code });
    }
    expect(handler).not.toHaveBeenCalled();
  });

  it('maps a non-API error page (proxy 502) and a network failure to ApiError', async () => {
    fetchMock.mockResolvedValueOnce(new Response('<html>Bad Gateway</html>', { status: 502 }));
    await expect(liveGet('/patients')).rejects.toMatchObject({ status: 502, code: 'UPSTREAM' });
    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    const err = await liveGet('/patients').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({ status: 0, code: 'NETWORK' });
  });
});

describe('seg', () => {
  it('encodes a no_rawat so the slashes stay inside one path segment', () => {
    expect(seg('2026/10/26/000123')).toBe('2026%2F10%2F26%2F000123');
  });
});
