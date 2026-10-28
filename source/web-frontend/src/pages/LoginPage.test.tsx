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
    expect(screen.getByText('Akun demo — hanya untuk peragaan')).toBeInTheDocument();
    expect(screen.getByText(/demo\.dokter/)).toBeInTheDocument();
    expect(await axeViolations(container)).toEqual([]);
  });

  it('signs in with the demo account and lands on the workspace', async () => {
    const user = userEvent.setup();
    renderApp('/login');
    await user.type(screen.getByLabelText('Nama pengguna'), 'demo.dokter');
    await user.type(screen.getByLabelText('Kata sandi'), 'Demo#2026');
    await user.click(screen.getByRole('button', { name: 'Masuk' }));
    expect(await screen.findByRole('navigation', { name: 'Jendela terbuka' })).toBeInTheDocument();
    expect(useAuthStore.getState().user).not.toBeNull();
  });

  it('rejects wrong credentials with an alert and clears the password', async () => {
    const user = userEvent.setup();
    renderApp('/login');
    await user.type(screen.getByLabelText('Nama pengguna'), 'demo.dokter');
    await user.type(screen.getByLabelText('Kata sandi'), 'salah');
    await user.click(screen.getByRole('button', { name: 'Masuk' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Nama pengguna atau kata sandi salah.',
    );
    expect(screen.getByLabelText('Kata sandi')).toHaveValue('');
    expect(useAuthStore.getState().user).toBeNull();
  });

  it('asks for both fields when empty', async () => {
    const user = userEvent.setup();
    renderApp('/login');
    await user.click(screen.getByRole('button', { name: 'Masuk' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Isi nama pengguna dan kata sandi.');
  });

  it('reveals the password on demand', async () => {
    const user = userEvent.setup();
    renderApp('/login');
    const pw = screen.getByLabelText('Kata sandi');
    expect(pw).toHaveAttribute('type', 'password');
    await user.click(screen.getByRole('button', { name: 'Tampilkan kata sandi' }));
    expect(pw).toHaveAttribute('type', 'text');
  });

  it('is disabled with an explanation when the demo account is not enabled in the build', () => {
    vi.stubEnv('VITE_DEMO_AUTH', 'false');
    renderApp('/login');
    expect(screen.getByRole('alert')).toHaveTextContent('Autentikasi demo tidak diaktifkan');
    expect(screen.getByRole('button', { name: 'Masuk' })).toBeDisabled();
    expect(screen.queryByText(/demo\.dokter/)).not.toBeInTheDocument();
  });

  it('switches to English and saves the choice per browser (hms.locale)', async () => {
    const user = userEvent.setup();
    renderApp('/login');
    await user.click(screen.getByRole('radio', { name: 'Ganti bahasa ke English' }));
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Sign in' })).toBeInTheDocument(),
    );
    expect(window.localStorage.getItem('hms.locale')).toBe('en');
    expect(document.documentElement.lang).toBe('en');
    expect(screen.getByLabelText('Username')).toBeInTheDocument();
  });

  it('shows why the last session ended', () => {
    useAuthStore.setState({ notice: 'idle' });
    renderApp('/login');
    expect(screen.getByRole('status')).toHaveTextContent(
      'Sesi berakhir karena tidak aktif selama 15 menit.',
    );
  });

  it('redirects unauthenticated visitors from /workspace to /login', () => {
    renderApp('/workspace');
    expect(screen.getByRole('button', { name: 'Masuk' })).toBeInTheDocument();
  });
});
