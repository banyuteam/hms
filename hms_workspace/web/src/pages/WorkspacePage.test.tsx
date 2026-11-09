import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderWorkspace } from '@/features/workspace/testProbe';
import { renderApp } from '@/test/utils';

beforeEach(() => {
  vi.stubEnv('VITE_DEMO_AUTH', 'true');
});

const dock = () => screen.getByRole('navigation', { name: 'Open windows' });

describe('workflow routes (/{workflow})', () => {
  it('/records opens the blank Medical Records window and its dock tab', async () => {
    const { probe } = renderWorkspace('/records');
    expect(await screen.findByRole('dialog', { name: 'Medical Records' })).toBeInTheDocument();
    expect(within(dock()).getByRole('button', { name: 'Records' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    expect(probe.state.windows.map((w) => w.id)).toEqual(['emr-records']);
    expect(probe.pathname).toBe('/records');
  });

  it('an unknown workflow shows the not-found page', () => {
    renderWorkspace('/nope');
    expect(screen.getByRole('heading', { name: 'Page not found' })).toBeInTheDocument();
    expect(screen.queryByRole('navigation', { name: 'Open windows' })).not.toBeInTheDocument();
  });

  it('focusing a window shows its workflow in the URL; Home returns to /', async () => {
    const user = userEvent.setup();
    const { probe } = renderWorkspace('/');
    await user.keyboard('{Alt>}{3}{/Alt}');
    await waitFor(() => expect(probe.pathname).toBe('/encounter'));
    await user.click(within(dock()).getByRole('button', { name: 'Home' }));
    await waitFor(() => expect(probe.pathname).toBe('/'));
    expect(probe.state.activeId).toBeNull();
    expect(probe.state.windows).toHaveLength(1);
  });

  it('a signed-out visitor to a workflow route is sent to the login screen', async () => {
    renderApp('/records');
    expect(await screen.findByRole('button', { name: 'Sign in' })).toBeInTheDocument();
    expect(screen.queryByRole('dialog', { name: 'Medical Records' })).not.toBeInTheDocument();
  });
});
