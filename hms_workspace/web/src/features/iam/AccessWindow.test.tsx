import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axeViolations, renderApp } from '@/test/utils';

// Synthetic data only. Ids are fixed UUID-shaped strings.
const ME = '01a1ba10-0000-7000-8000-000000000001';
const BOB = '01a1ba10-0000-7000-8000-000000000002';
const FACILITY = '01a1ba10-0000-7000-8000-0000000000bb';
const ADMIN_ROLE_ID = '01a1ba10-0000-7000-8000-00000000a001';
const NURSE_ROLE_ID = '01a1ba10-0000-7000-8000-00000000a002';
const ALL = ['iam.users.read', 'iam.users.manage', 'iam.roles.manage', 'iam.assignments.manage'];

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const error = (status: number, code: string) => json({ error: { code, message: 'x' } }, status);

const user = (id: string, name: string, extra: Record<string, unknown> = {}) => ({
  id,
  display_name: name,
  status: 'active',
  status_reason: null,
  created_at: '2026-11-08T01:00:00Z',
  identities: [
    { issuer: 'legacy-hms:dokter', subject: `D-${name.length}`, last_authenticated_at: null },
  ],
  assignments: [],
  ...extra,
});

interface Sent {
  method: string;
  url: string;
  body: unknown;
}

/** In-memory hms-services for the IAM endpoints. */
let state: {
  permissions: string[];
  users: ReturnType<typeof user>[];
  failNext: Response | null;
  listAnswer: (() => Response) | null;
  sent: Sent[];
};

function sessionBody() {
  return {
    user: { id: ME, display_name: 'Admin Synthetic' },
    organization_id: '01a1ba10-0000-7000-8000-0000000000aa',
    facility_id: FACILITY,
    expires_at: '2026-11-08T20:00:00Z',
    permissions: state.permissions,
  };
}

const roles = () => [
  {
    id: ADMIN_ROLE_ID,
    code: 'iam-admin',
    name: 'IAM administrator',
    description: null,
    status: 'active',
    system: true,
    permissions: ALL,
  },
  {
    id: NURSE_ROLE_ID,
    code: 'ward-nurse',
    name: 'Ward nurse',
    description: 'Synthetic test role',
    status: 'active',
    system: false,
    permissions: ['iam.users.read'],
  },
];

let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  vi.stubEnv('VITE_DATA_SOURCE', 'bff');
  state = {
    permissions: ALL,
    users: [
      user(ME, 'Admin Synthetic', {
        assignments: [
          {
            id: 'as-1',
            role_id: ADMIN_ROLE_ID,
            role_code: 'iam-admin',
            facility_id: null,
            valid_from: '2026-11-08T01:00:00Z',
            valid_until: null,
            granted_at: '2026-11-08T01:00:00Z',
          },
        ],
      }),
      user(BOB, 'Bob Synthetic'),
    ],
    failNext: null,
    listAnswer: null,
    sent: [],
  };
  fetchMock = vi.fn(async (url: string, init: RequestInit = {}) => {
    const method = init.method ?? 'GET';
    const path = url.split('?')[0]!;
    if (method !== 'GET') {
      state.sent.push({
        method,
        url: path,
        body: init.body ? JSON.parse(init.body as string) : null,
      });
      if (state.failNext) {
        const r = state.failNext;
        state.failNext = null;
        return r;
      }
    }
    if (path === '/api/v1/auth/session') return json(sessionBody());
    if (path === '/api/v1/auth/sign-out') return new Response(null, { status: 204 });
    if (path === '/api/v1/iam/users' && method === 'GET')
      return state.listAnswer ? state.listAnswer() : json({ users: state.users });
    if (path === '/api/v1/iam/roles' && method === 'GET') return json({ roles: roles() });
    if (path === '/api/v1/iam/permissions')
      return json({
        permissions: ALL.map((code) => ({
          code,
          description: `Synthetic ${code}`,
          status: 'active',
        })),
      });
    const patch = path.match(/^\/api\/v1\/iam\/users\/([^/]+)$/);
    if (patch && method === 'PATCH') {
      const u = state.users.find((x) => x.id === patch[1])!;
      const body = JSON.parse(init.body as string) as { status: string; reason?: string };
      Object.assign(u, { status: body.status, status_reason: body.reason ?? null });
      return json(u);
    }
    if (path.endsWith('/role-assignments') && method === 'POST') {
      const id = path.split('/')[5]!;
      const body = JSON.parse(init.body as string) as {
        role_id: string;
        facility_id: string | null;
      };
      state.users
        .find((x) => x.id === id)!
        .assignments.push({
          id: 'as-new',
          role_id: body.role_id,
          role_code: 'ward-nurse',
          facility_id: body.facility_id,
          valid_from: '2026-11-08T02:00:00Z',
          valid_until: null,
          granted_at: '2026-11-08T02:00:00Z',
        } as never);
      return json({ id: 'as-new' }, 201);
    }
    if (path.endsWith('/revoke')) return new Response(null, { status: 204 });
    if (path === '/api/v1/iam/roles' && method === 'POST')
      return json({ ...roles()[1], id: 'new-role', code: 'lab-viewer', name: 'Lab viewer' }, 201);
    if (path.endsWith('/permissions') && method === 'PUT') return json(roles()[1]);
    return json({}, 404);
  });
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

const sentTo = (suffix: string) => state.sent.filter((s) => s.url.endsWith(suffix));

async function openBob(u: ReturnType<typeof userEvent.setup>) {
  await u.click(await screen.findByRole('button', { name: 'Bob Synthetic' }));
  return screen.getByRole('region', { name: 'Selected user' });
}

describe('Home', () => {
  it('offers User & Access only to sessions with iam.users.read', async () => {
    renderApp('/');
    expect(await screen.findByRole('heading', { name: 'Administration' })).toBeInTheDocument();
  });

  it('shows no administration card without the permission', async () => {
    state.permissions = [];
    renderApp('/');
    expect((await screen.findAllByText('Staff · view only')).length).toBeGreaterThan(0);
    expect(screen.queryByRole('heading', { name: 'Administration' })).not.toBeInTheDocument();
  });
});

describe('User & Access window', () => {
  it('lists the organization’s users and shows the selected user’s access, accessibly', async () => {
    const u = userEvent.setup();
    const { container } = renderApp('/access');
    expect(await screen.findByRole('tab', { name: 'Users' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    const table = await screen.findByRole('table', { name: 'Users' });
    expect(within(table).getByRole('button', { name: 'Admin Synthetic' })).toBeInTheDocument();
    const detail = await openBob(u);
    expect(
      within(detail).getByText('No roles: this user can sign in but cannot do anything yet.'),
    ).toBeInTheDocument();
    expect(within(detail).getByText('Has not signed in yet')).toBeInTheDocument();
    expect(await axeViolations(container)).toEqual([]);
  });

  it('grants a role in two steps: nothing is sent until the summary is confirmed', async () => {
    const u = userEvent.setup();
    renderApp('/access');
    const detail = await openBob(u);
    const grant = within(detail).getByRole('form', { name: 'Grant a role' });
    await u.click(within(grant).getByRole('button', { name: 'Review before granting' }));
    expect(await within(grant).findByText('Choose a role.')).toBeInTheDocument();
    // How long the access lasts is a choice, never a silent "no end date".
    expect(within(grant).getByText('Choose how long it is valid.')).toBeInTheDocument();
    expect(within(grant).getByLabelText('Role')).toHaveAttribute('aria-invalid', 'true');

    await u.selectOptions(within(grant).getByLabelText('Role'), NURSE_ROLE_ID);
    await u.click(within(grant).getByRole('radio', { name: 'Whole organization' }));
    await u.click(within(grant).getByRole('radio', { name: 'No end date' }));
    await u.type(within(grant).getByLabelText('Reason'), 'Ward rotation');
    await u.click(within(grant).getByRole('button', { name: 'Review before granting' }));
    const summary = await within(detail).findByRole('region', {
      name: 'Grant Ward nurse to Bob Synthetic?',
    });
    expect(within(summary).getByRole('heading')).toHaveFocus();
    expect(within(summary).getByText(/This is broad access/)).toBeInTheDocument();
    expect(sentTo('/role-assignments')).toHaveLength(0);

    await u.click(within(summary).getByRole('button', { name: 'Grant role' }));
    await waitFor(() => expect(sentTo('/role-assignments')).toHaveLength(1));
    expect(sentTo('/role-assignments')[0]!.body).toEqual({
      role_id: NURSE_ROLE_ID,
      facility_id: null,
      valid_until: null,
      reason: 'Ward rotation',
    });
    // Visible and specific, not only announced.
    expect(await screen.findByText('Ward nurse granted to Bob Synthetic.')).toBeVisible();
    const assignments = within(detail).getByRole('region', { name: 'Role assignments' });
    expect(await within(assignments).findByText('Ward nurse')).toBeInTheDocument();
  });

  it('starts at this facility (least privilege) and grants until the chosen date', async () => {
    const u = userEvent.setup();
    renderApp('/access');
    const detail = await openBob(u);
    const grant = within(detail).getByRole('form', { name: 'Grant a role' });
    expect(within(grant).getByRole('radio', { name: 'This facility' })).toBeChecked();
    await u.selectOptions(within(grant).getByLabelText('Role'), NURSE_ROLE_ID);
    await u.click(within(grant).getByRole('radio', { name: 'Until a date' }));
    await u.type(within(grant).getByLabelText('End date'), '2099-01-31');
    await u.type(within(grant).getByLabelText('Reason'), 'Night shift');
    await u.click(within(grant).getByRole('button', { name: 'Review before granting' }));
    const summary = await within(detail).findByRole('region', { name: /^Grant Ward nurse/ });
    expect(within(summary).queryByText(/This is broad access/)).not.toBeInTheDocument();
    await u.click(within(summary).getByRole('button', { name: 'Grant role' }));
    await waitFor(() => expect(sentTo('/role-assignments')).toHaveLength(1));
    expect(sentTo('/role-assignments')[0]!.body).toMatchObject({ facility_id: FACILITY });
    expect((sentTo('/role-assignments')[0]!.body as { valid_until: string }).valid_until).toMatch(
      /^2099-01-31T/,
    );
  });

  it('warns plainly before the system administrator role is granted', async () => {
    const u = userEvent.setup();
    renderApp('/access');
    const detail = await openBob(u);
    const grant = within(detail).getByRole('form', { name: 'Grant a role' });
    await u.selectOptions(within(grant).getByLabelText('Role'), ADMIN_ROLE_ID);
    await u.click(within(grant).getByRole('radio', { name: 'No end date' }));
    await u.type(within(grant).getByLabelText('Reason'), 'Backup administrator');
    await u.click(within(grant).getByRole('button', { name: 'Review before granting' }));
    const summary = await within(detail).findByRole('region', { name: /^Grant IAM administrator/ });
    expect(within(summary).getByText(/system administrator role/)).toBeInTheDocument();
    // "Change" goes back to the form with what was entered.
    await u.click(within(summary).getByRole('button', { name: 'Change' }));
    expect(within(grant).getByLabelText('Reason')).toHaveValue('Backup administrator');
    expect(sentTo('/role-assignments')).toHaveLength(0);
  });

  it('suspends only with a reason, and explains a refused change without losing the form', async () => {
    const u = userEvent.setup();
    renderApp('/access');
    const detail = await openBob(u);
    await u.click(within(detail).getByRole('button', { name: 'Suspend' }));
    const confirm = within(detail).getByRole('form', { name: 'Suspend Bob Synthetic' });
    // Says visibly what is being confirmed, what it does, and where the reason goes; focus is in the form.
    expect(within(confirm).getByRole('heading', { name: 'Suspend Bob Synthetic' })).toBeVisible();
    expect(within(confirm).getByText(/sessions end at once/)).toBeInTheDocument();
    expect(within(confirm).getByLabelText('Reason')).toHaveFocus();
    expect(within(confirm).getByLabelText('Reason')).toHaveAccessibleDescription(/audit trail/);
    await u.click(within(confirm).getByRole('button', { name: 'Suspend' }));
    expect(await within(confirm).findByText('Enter a reason.')).toBeInTheDocument();
    expect(sentTo(BOB)).toHaveLength(0);

    state.failNext = error(409, 'last_admin');
    await u.type(within(confirm).getByLabelText('Reason'), 'Left the hospital');
    await u.click(within(confirm).getByRole('button', { name: 'Suspend' }));
    expect(await within(confirm).findByRole('alert')).toHaveTextContent(
      'without an active IAM administrator',
    );
    expect(within(confirm).getByLabelText('Reason')).toHaveValue('Left the hospital');

    await u.click(within(confirm).getByRole('button', { name: 'Suspend' }));
    await waitFor(() => expect(sentTo(BOB)).toHaveLength(2));
    expect(sentTo(BOB)[1]).toMatchObject({
      method: 'PATCH',
      body: { status: 'suspended', reason: 'Left the hospital' },
    });
    expect(await within(detail).findByText('Reason: Left the hospital')).toBeInTheDocument();
    expect(within(detail).getByRole('button', { name: 'Reactivate' })).toBeInTheDocument();
  });

  it('Cancel puts the focus back on the button that opened the confirmation', async () => {
    const u = userEvent.setup();
    renderApp('/access');
    const detail = await openBob(u);
    await u.click(within(detail).getByRole('button', { name: 'Deactivate' }));
    const confirm = within(detail).getByRole('form', { name: 'Deactivate Bob Synthetic' });
    await u.click(within(confirm).getByRole('button', { name: 'Cancel' }));
    expect(within(detail).getByRole('button', { name: 'Deactivate' })).toHaveFocus();
  });

  it('offers no changes to your own account', async () => {
    const u = userEvent.setup();
    renderApp('/access');
    await u.click(await screen.findByRole('button', { name: 'Admin Synthetic' }));
    const detail = screen.getByRole('region', { name: 'Selected user' });
    expect(within(detail).getByText(/This is you/)).toBeInTheDocument();
    expect(within(detail).queryByRole('button', { name: 'Suspend' })).not.toBeInTheDocument();
    expect(within(detail).queryByRole('button', { name: 'Revoke' })).not.toBeInTheDocument();
    expect(within(detail).queryByRole('form', { name: 'Grant a role' })).not.toBeInTheDocument();
  });

  it('a view-only administrator sees users but no change controls', async () => {
    state.permissions = ['iam.users.read'];
    const u = userEvent.setup();
    renderApp('/access');
    const detail = await openBob(u);
    expect(within(detail).queryByRole('button', { name: 'Suspend' })).not.toBeInTheDocument();
    expect(within(detail).queryByRole('form', { name: 'Grant a role' })).not.toBeInTheDocument();
  });

  it('shows the permission-denied state when the server refuses the list', async () => {
    state.listAnswer = () => error(403, 'forbidden');
    renderApp('/access');
    expect(await screen.findByRole('alert')).toHaveTextContent('No access to user administration');
  });

  it('distinguishes a failed load from an empty list, and can retry', async () => {
    let calls = 0;
    state.listAnswer = () =>
      ++calls === 1 ? error(503, 'service_unavailable') : json({ users: [] });
    const u = userEvent.setup();
    renderApp('/access');
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not load');
    await u.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText(/No users here/)).toBeInTheDocument();
  });

  it('Roles tab: arrow keys switch tabs; the system role is read-only; a new role is created', async () => {
    const u = userEvent.setup();
    renderApp('/access');
    const usersTab = await screen.findByRole('tab', { name: 'Users' });
    usersTab.focus();
    await u.keyboard('{ArrowRight}');
    expect(screen.getByRole('tab', { name: 'Roles' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: 'Roles' })).toHaveFocus();

    await u.click(await screen.findByRole('button', { name: /IAM administrator/ }));
    expect(screen.getByText(/managed by HMS and cannot be changed/)).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: 'Synthetic iam.users.read' })).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Save permissions' })).not.toBeInTheDocument();

    await u.click(screen.getByRole('button', { name: 'New role' }));
    const form = screen.getByRole('form', { name: 'New role' });
    await u.type(within(form).getByLabelText('Code'), 'Lab Viewer');
    await u.type(within(form).getByLabelText('Name'), 'Lab viewer');
    await u.click(within(form).getByRole('button', { name: 'Create role' }));
    expect(await within(form).findByText(/lowercase letters/)).toBeInTheDocument();
    await u.clear(within(form).getByLabelText('Code'));
    await u.type(within(form).getByLabelText('Code'), 'lab-viewer');
    await u.click(within(form).getByRole('checkbox', { name: 'Synthetic iam.users.read' }));
    await u.click(within(form).getByRole('button', { name: 'Create role' }));
    await waitFor(() =>
      expect(state.sent.filter((s) => s.url === '/api/v1/iam/roles')).toHaveLength(1),
    );
    expect(state.sent.find((s) => s.url === '/api/v1/iam/roles')!.body).toEqual({
      code: 'lab-viewer',
      name: 'Lab viewer',
      description: '',
      permissions: ['iam.users.read'],
    });
  });
  it('Roles tab: saving permissions shows what changes for everyone with the role; leaving unsaved asks', async () => {
    const u = userEvent.setup();
    renderApp('/access');
    await u.click(await screen.findByRole('tab', { name: 'Roles' }));
    await u.click(await screen.findByRole('button', { name: /Ward nurse/ }));
    await u.click(screen.getByRole('checkbox', { name: 'Synthetic iam.roles.manage' }));
    await u.click(screen.getByRole('checkbox', { name: 'Synthetic iam.users.read' }));

    // Unsaved ticks: opening another role asks first.
    await u.click(screen.getByRole('button', { name: /IAM administrator/ }));
    expect(screen.getByRole('alert')).toHaveTextContent('are not saved');
    await u.click(screen.getByRole('button', { name: 'Back to the changes' }));
    expect(screen.getByRole('checkbox', { name: 'Synthetic iam.roles.manage' })).toBeChecked();

    await u.click(screen.getByRole('button', { name: 'Review changes' }));
    const review = screen.getByRole('region', { name: 'Permission changes to Ward nurse' });
    expect(within(review).getByRole('heading', { level: 4 })).toHaveFocus();
    expect(within(review).getByText('Added')).toBeInTheDocument();
    expect(within(review).getByText(/Synthetic iam.roles.manage/)).toBeInTheDocument();
    expect(within(review).getByText('Removed')).toBeInTheDocument();
    expect(within(review).getByText(/every user who holds Ward nurse/)).toBeInTheDocument();
    expect(state.sent.filter((x) => x.method === 'PUT')).toHaveLength(0);

    await u.click(screen.getByRole('button', { name: 'Save permissions' }));
    await waitFor(() => expect(state.sent.filter((x) => x.method === 'PUT')).toHaveLength(1));
    expect(state.sent.find((x) => x.method === 'PUT')!.body).toEqual({
      permissions: ['iam.roles.manage'],
    });
    expect(await screen.findByText('Permissions of Ward nurse saved.')).toBeVisible();
  });
});

describe('demo build', () => {
  it('shows that administration needs the live connection and makes no request', async () => {
    vi.stubEnv('VITE_DATA_SOURCE', '');
    renderApp('/access', { role: 'doctor' });
    expect(await screen.findByText(/needs the live connection/)).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
