import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { liveGet } from '@/api/liveApi';
import { axeViolations, renderApp } from '@/test/utils';

const answer = (status: number, body: unknown = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const error = (status: number, code: string) => answer(status, { error: { code, message: 'x' } });
/** An auth-v1 session body (synthetic). */
const session = (permissions: string[] = [], name = 'dr. Test Synthetic') => ({
  user: { id: '01a1ba10-0000-7000-8000-000000000001', display_name: name },
  organization_id: '01a1ba10-0000-7000-8000-0000000000aa',
  facility_id: '01a1ba10-0000-7000-8000-0000000000bb',
  expires_at: '2026-11-08T20:00:00Z',
  permissions,
});

/** A fake hms-services: answers by path; `signIn`, `current` and `api` are set per test. */
const server = {
  current: null as unknown, // GET /api/v1/auth/session body (null = 401, signed out)
  signIn: (): Response => error(401, 'invalid_credentials'),
  api: (): Response => answer(200, { data: [], page: { limit: 25, next_cursor: null } }),
};
let fetchMock: ReturnType<typeof vi.fn>;
const callsTo = (path: string) =>
  fetchMock.mock.calls.filter(([u]) => String(u).startsWith(path)) as [string, RequestInit][];

beforeEach(() => {
  vi.stubEnv('VITE_DEMO_AUTH', 'true');
  vi.stubEnv('VITE_DATA_SOURCE', 'bff');
  server.current = null;
  server.signIn = () => error(401, 'invalid_credentials');
  server.api = () => answer(200, { data: [], page: { limit: 25, next_cursor: null } });
  fetchMock = vi.fn(async (url: string) => {
    if (url === '/api/v1/auth/session')
      return server.current ? answer(200, server.current) : error(401, 'unauthenticated');
    if (url === '/api/v1/auth/sign-in') return server.signIn();
    if (url === '/api/v1/auth/sign-out') return new Response(null, { status: 204 });
    if (url.startsWith('/api/')) return server.api();
    return answer(404);
  });
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

type User = ReturnType<typeof userEvent.setup>;
const userId = () => screen.getByLabelText('Khanza user ID');
const password = () => screen.getByLabelText('Password');
const submit = (user: User) => user.click(screen.getByRole('button', { name: 'Sign in' }));
async function fill(user: User, id: string, pw: string) {
  await user.type(await screen.findByLabelText('Khanza user ID'), id);
  await user.type(password(), pw);
}
const sentSignIn = () => JSON.parse(callsTo('/api/v1/auth/sign-in')[0]![1].body as string);

describe('live sign-in through hms_services (auth-v1: Khanza user ID + password)', () => {
  it('asks for the Khanza user ID and password only: no role choice, no demo account', async () => {
    const { container } = renderApp('/login');
    expect(await screen.findByLabelText('Khanza user ID')).toBeInTheDocument();
    expect(password()).toHaveAttribute('type', 'password');
    expect(screen.queryByRole('radio')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Username')).not.toBeInTheDocument();
    expect(screen.queryByText(/demo.dokter/)).not.toBeInTheDocument();
    expect(await axeViolations(container)).toEqual([]);
  });

  it('asks for both fields, and rejects a malformed ID with the generic message, before calling the server', async () => {
    const user = userEvent.setup();
    renderApp('/login');
    await screen.findByLabelText('Khanza user ID');
    await submit(user);
    expect(await screen.findByRole('alert')).toHaveTextContent('Enter your user ID and password.');
    await fill(user, '-rf', 'x');
    await submit(user);
    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent('Incorrect user ID or password'),
    );
    expect(userId()).toHaveAttribute('aria-invalid', 'true');
    expect(callsTo('/api/v1/auth/sign-in')).toHaveLength(0);
  });

  it('a refused sign-in gives one generic message, clears the password and signs nobody in', async () => {
    const user = userEvent.setup();
    renderApp('/login');
    await fill(user, 'D001', 'wrong');
    await submit(user);
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Incorrect user ID or password, or this person is not an active doctor or employee.',
    );
    expect(password()).toHaveValue('');
    expect(userId()).toHaveValue('D001');
  });

  it('explains a suspended account, rate limiting and an unavailable service differently', async () => {
    const user = userEvent.setup();
    renderApp('/login');
    server.signIn = () => error(403, 'account_disabled');
    await fill(user, 'D001', 'pw');
    await submit(user);
    expect(await screen.findByRole('alert')).toHaveTextContent('suspended or deactivated');

    server.signIn = () => error(429, 'too_many_attempts');
    await user.type(password(), 'pw');
    await submit(user);
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Too many attempts'));

    server.signIn = () => error(403, 'origin_not_allowed'); // a deployment problem, not the user's
    await user.type(password(), 'pw');
    await submit(user);
    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent('sign-in service is not available'),
    );

    server.signIn = () => {
      throw new TypeError('Failed to fetch');
    };
    await user.type(password(), 'pw');
    await submit(user);
    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent('sign-in service is not available'),
    );
  });

  it('treats a malformed success answer as unavailable, never as signed in', async () => {
    const user = userEvent.setup();
    server.signIn = () => answer(200, { user: { id: 7 } });
    renderApp('/login');
    await fill(user, 'D001', 'pw');
    await submit(user);
    expect(await screen.findByRole('alert')).toHaveTextContent('sign-in service is not available');
    expect(userId()).toBeInTheDocument();
  });

  it('signs in: workspace with the person’s name, nothing stored in the browser, password never kept', async () => {
    const user = userEvent.setup();
    server.signIn = () => answer(200, session());
    renderApp('/login');
    await fill(user, ' D001 ', 'rahasia');
    await submit(user);

    expect(await screen.findByText('LIVE DATA · dev')).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('dr. Test Synthetic');
    expect(sentSignIn()).toEqual({ user_id: 'D001', password: 'rahasia' });
    expect(callsTo('/api/v1/auth/sign-in')[0]![1]).toMatchObject({
      method: 'POST',
      credentials: 'same-origin',
    });
    expect(screen.queryByLabelText('Khanza user ID')).not.toBeInTheDocument();
    expect(window.localStorage.length).toBe(0);
    expect(window.sessionStorage.length).toBe(0);
  });

  it('production build: no dev badge, view-only labels for a session without clinical permissions', async () => {
    vi.stubEnv('DEV', false);
    const user = userEvent.setup();
    server.signIn = () => answer(200, session());
    renderApp('/login');
    await fill(user, 'D001', 'rahasia'); // waits for the session check to finish and the form to show
    expect(
      screen.getByText(
        'The session ends automatically when the tab is closed or after inactivity.',
      ),
    ).toBeInTheDocument();
    await submit(user);
    expect(
      await screen.findByRole('button', { name: 'dr. Test Synthetic HMS staff — User menu' }),
    ).toBeInTheDocument();
    expect(screen.queryByText('LIVE DATA · dev')).not.toBeInTheDocument();
    expect(screen.getAllByText('Staff · view only').length).toBeGreaterThan(0);
    expect(screen.queryByText('Open & edit')).not.toBeInTheDocument();
  });

  it('signing out ends the server session', async () => {
    const user = userEvent.setup();
    server.signIn = () => answer(200, session());
    renderApp('/login');
    await fill(user, 'D001', 'pw');
    await submit(user);
    await user.click(await screen.findByRole('button', { name: /User menu/ }));
    await user.click(await screen.findByRole('button', { name: 'Sign out' }));
    expect(await screen.findByLabelText('Khanza user ID')).toBeInTheDocument();
    await waitFor(() => expect(callsTo('/api/v1/auth/sign-out')).toHaveLength(1));
    expect(callsTo('/api/v1/auth/sign-out')[0]![1]).toMatchObject({
      method: 'POST',
      credentials: 'same-origin',
    });
  });

  it('a 401 later in the session returns to the sign-in with a notice, without another sign-out call', async () => {
    const user = userEvent.setup();
    server.signIn = () => answer(200, session());
    renderApp('/login');
    await fill(user, 'D001', 'pw');
    await submit(user);
    await screen.findByText('LIVE DATA · dev');

    server.api = () => error(401, 'unauthenticated');
    await act(async () => {
      await liveGet('/patients').catch(() => undefined);
    });
    expect(await screen.findByLabelText('Khanza user ID')).toBeInTheDocument();
    expect(screen.getByText(/expired or was rejected/)).toBeInTheDocument();
    expect(callsTo('/api/v1/auth/sign-out')).toHaveLength(0); // the server already ended it
  });
});

describe('page reload with a live session', () => {
  it('resumes the session and keeps the workflow route, without showing the sign-in', async () => {
    server.current = session();
    renderApp('/records');
    expect(screen.getByText('Checking your session…')).toBeInTheDocument();
    expect(await screen.findByText('LIVE DATA · dev')).toBeInTheDocument();
    expect(screen.queryByLabelText('Khanza user ID')).not.toBeInTheDocument();
    expect(callsTo('/api/v1/auth/session')).toHaveLength(1);
  });

  it('shows the sign-in when there is no session', async () => {
    renderApp('/records');
    expect(await screen.findByLabelText('Khanza user ID')).toBeInTheDocument();
  });

  it('shows the sign-in when the server cannot be reached (never treated as signed in)', async () => {
    fetchMock.mockImplementationOnce(async () => {
      throw new TypeError('Failed to fetch');
    });
    renderApp('/records');
    expect(await screen.findByLabelText('Khanza user ID')).toBeInTheDocument();
    expect(screen.queryByText('LIVE DATA · dev')).not.toBeInTheDocument();
    expect(callsTo('/api/v1/auth/session')).toHaveLength(1);
  });
});

describe('default (synthetic) sign-in is unchanged', () => {
  it('without VITE_DATA_SOURCE=bff the demo form shows and no request is ever made', () => {
    vi.stubEnv('VITE_DATA_SOURCE', '');
    renderApp('/login');
    expect(screen.getByLabelText('Username')).toBeInTheDocument();
    expect(screen.queryByLabelText('Khanza user ID')).not.toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
