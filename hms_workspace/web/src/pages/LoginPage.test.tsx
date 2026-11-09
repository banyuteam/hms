import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { AppRoutes } from '@/App';
import { AppProviders } from '@/AppProviders';
import type { AuthState } from '@/state/auth';
import userEvent from '@testing-library/user-event';
import { axeViolations, renderApp } from '@/test/utils';

beforeEach(() => {
  vi.stubEnv('VITE_DEMO_AUTH', 'true');
  window.localStorage.clear();
});

/** Providers with their real defaults (no test locale), optionally with a session-ended notice. */
function renderBare(initialAuth?: AuthState, initialLocale?: 'en' | 'id') {
  return render(
    <AppProviders initialAuth={initialAuth} initialLocale={initialLocale}>
      <MemoryRouter initialEntries={['/login']}>
        <AppRoutes />
      </MemoryRouter>
    </AppProviders>,
  );
}

describe('Login (static demo account)', () => {
  it('shows the demo-account banner with the demo credentials and no a11y violations', async () => {
    const { container } = renderApp('/login');
    expect(screen.getByText('Demo account — for demonstration only')).toBeInTheDocument();
    expect(screen.getByText(/demo\.dokter/)).toBeInTheDocument();
    expect(await axeViolations(container)).toEqual([]);
  });

  it('signs in with the demo account and lands on the workspace', async () => {
    const user = userEvent.setup();
    renderApp('/login');
    await user.type(screen.getByLabelText('Username'), 'demo.dokter');
    await user.type(screen.getByLabelText('Password'), 'Demo#2026');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByRole('navigation', { name: 'Open windows' })).toBeInTheDocument();
    expect(screen.queryByLabelText('Username')).not.toBeInTheDocument();
  });

  it('rejects wrong credentials with an alert and clears the password', async () => {
    const user = userEvent.setup();
    renderApp('/login');
    await user.type(screen.getByLabelText('Username'), 'demo.dokter');
    await user.type(screen.getByLabelText('Password'), 'salah');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Incorrect username or password.');
    expect(screen.getByLabelText('Password')).toHaveValue('');
    expect(screen.getByLabelText('Username')).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeInTheDocument();
  });

  it('asks for both fields when empty (zod schema, localized message linked to the fields)', async () => {
    const user = userEvent.setup();
    renderApp('/login');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Enter your username and password.');
    expect(screen.getByLabelText('Username')).toHaveAttribute('aria-describedby', alert.id);
  });

  it('localizes the validation message in Indonesian', async () => {
    const user = userEvent.setup();
    renderApp('/login', { locale: 'id' });
    await user.click(screen.getByRole('button', { name: 'Masuk' }));
    expect(await screen.findByRole('alert')).not.toHaveTextContent('login.error.required');
  });

  it('reveals the password on demand', async () => {
    const user = userEvent.setup();
    renderApp('/login');
    const pw = screen.getByLabelText('Password');
    expect(pw).toHaveAttribute('type', 'password');
    await user.click(screen.getByRole('button', { name: 'Show password' }));
    expect(pw).toHaveAttribute('type', 'text');
  });

  it('is disabled with an explanation when the demo account is not enabled in the build', () => {
    vi.stubEnv('VITE_DEMO_AUTH', 'false');
    renderApp('/login');
    expect(screen.getByRole('alert')).toHaveTextContent('Demo authentication is not enabled');
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeDisabled();
    expect(screen.queryByText(/demo\.dokter/)).not.toBeInTheDocument();
  });

  it('is Indonesian by default and switches language in memory only (nothing in web storage)', async () => {
    const user = userEvent.setup();
    renderBare();
    expect(screen.getByRole('button', { name: 'Masuk' })).toBeInTheDocument();
    expect(document.documentElement.lang).toBe('id');
    await user.click(screen.getByRole('button', { name: /English/ }));
    expect(await screen.findByRole('button', { name: 'Sign in' })).toBeInTheDocument();
    expect(document.documentElement.lang).toBe('en');
    expect(window.localStorage.length).toBe(0);
    expect(window.sessionStorage.length).toBe(0);
  });

  it('shows why the last session ended', () => {
    renderBare({ user: null, notice: 'idle' }, 'en');
    expect(screen.getByRole('status')).toHaveTextContent(
      'Your session ended after 15 minutes of inactivity.',
    );
  });

  it('redirects unauthenticated visitors from a workflow route to /login', () => {
    renderApp('/records');
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeInTheDocument();
  });
});
