import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useAuthStore } from '@/auth/authStore';
import { axeViolations, renderApp, resetStores } from '@/test/utils';

beforeEach(() => {
  vi.stubEnv('VITE_DEMO_AUTH', 'true');
  resetStores();
});

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
    expect(useAuthStore.getState().user).not.toBeNull();
  });

  it('rejects wrong credentials with an alert and clears the password', async () => {
    const user = userEvent.setup();
    renderApp('/login');
    await user.type(screen.getByLabelText('Username'), 'demo.dokter');
    await user.type(screen.getByLabelText('Password'), 'salah');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Incorrect username or password.');
    expect(screen.getByLabelText('Password')).toHaveValue('');
    expect(useAuthStore.getState().user).toBeNull();
  });

  it('asks for both fields when empty', async () => {
    const user = userEvent.setup();
    renderApp('/login');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Enter your username and password.');
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

  it('is English by default, switches to Indonesian and saves the choice per browser (hms.locale)', async () => {
    const user = userEvent.setup();
    renderApp('/login');
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeInTheDocument();
    expect(window.localStorage.getItem('hms.locale')).toBeNull();
    await user.click(screen.getByRole('radio', { name: 'Switch language to Bahasa Indonesia' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Masuk' })).toBeInTheDocument());
    expect(window.localStorage.getItem('hms.locale')).toBe('id');
    expect(document.documentElement.lang).toBe('id');
    expect(screen.getByLabelText('Nama pengguna')).toBeInTheDocument();
  });

  it('shows why the last session ended', () => {
    useAuthStore.setState({ notice: 'idle' });
    renderApp('/login');
    expect(screen.getByRole('status')).toHaveTextContent(
      'Your session ended after 15 minutes of inactivity.',
    );
  });

  it('redirects unauthenticated visitors from /workspace to /login', () => {
    renderApp('/workspace');
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeInTheDocument();
  });
});
