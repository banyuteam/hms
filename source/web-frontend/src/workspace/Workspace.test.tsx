import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useAuthStore } from '@/auth/authStore';
import { axeViolations, renderApp, resetStores, signIn } from '@/test/utils';
import { useWindowStore } from './windowStore';

beforeEach(() => {
  vi.stubEnv('VITE_DEMO_AUTH', 'true');
  resetStores();
  signIn();
});

const dock = () => screen.getByRole('navigation', { name: 'Jendela terbuka' });

describe('Workspace: first window + dock', () => {
  it('shows Beranda with the quick-start tiles, the dock and no windows', async () => {
    const { container } = renderApp('/workspace');
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(
      /^Selamat (pagi|siang|sore|malam), Pengguna Demo$/,
    );
    expect(screen.getByRole('button', { name: /Manajemen Pasien/ })).toBeEnabled();
    expect(screen.getByRole('button', { name: /Rekam Medis/ })).toBeDisabled(); // "Segera"
    expect(within(dock()).getByRole('button', { name: 'Beranda' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    expect(screen.queryByRole('dialog', { name: 'Manajemen Pasien' })).not.toBeInTheDocument();
    expect(await axeViolations(container)).toEqual([]);
  });

  it('opens Manajemen Pasien from a tile: window + dock tab + synthetic table', async () => {
    const user = userEvent.setup();
    const { container } = renderApp('/workspace');
    await user.click(screen.getByRole('button', { name: /Manajemen Pasien/ }));
    const win = await screen.findByRole('dialog', { name: 'Manajemen Pasien' });
    expect(within(win).getByRole('table', { name: 'Daftar pasien' })).toBeInTheDocument();
    expect(within(win).getAllByRole('row')).toHaveLength(9); // header + 8 synthetic rows
    expect(within(dock()).getByRole('button', { name: 'Manajemen Pasien' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    expect(within(dock()).getByRole('button', { name: 'Beranda' })).not.toHaveAttribute(
      'aria-current',
    );
    expect(await axeViolations(container)).toEqual([]);
  });

  it('minimise hides the window but keeps its dock tab; the tab restores it', async () => {
    const user = userEvent.setup();
    renderApp('/workspace');
    await user.click(screen.getByRole('button', { name: /Manajemen Pasien/ }));
    await user.click(await screen.findByRole('button', { name: 'Minimalkan Manajemen Pasien' }));
    expect(screen.queryByRole('dialog', { name: 'Manajemen Pasien' })).not.toBeInTheDocument();
    const tab = within(dock()).getByRole('button', { name: 'Manajemen Pasien' });
    await user.click(tab);
    expect(await screen.findByRole('dialog', { name: 'Manajemen Pasien' })).toBeVisible();
  });

  it('maximise/restore toggles and close removes the window and tab', async () => {
    const user = userEvent.setup();
    renderApp('/workspace');
    await user.click(screen.getByRole('button', { name: /Manajemen Pasien/ }));
    await user.click(await screen.findByRole('button', { name: 'Maksimalkan Manajemen Pasien' }));
    expect(useWindowStore.getState().windows[0]?.maximized).toBe(true);
    await user.click(screen.getByRole('button', { name: 'Pulihkan Manajemen Pasien' }));
    expect(useWindowStore.getState().windows[0]?.maximized).toBe(false);
    await user.click(
      within(screen.getByRole('dialog', { name: 'Manajemen Pasien' })).getByRole('button', {
        name: 'Tutup Manajemen Pasien',
      }),
    );
    expect(screen.queryByRole('dialog', { name: 'Manajemen Pasien' })).not.toBeInTheDocument();
    expect(
      within(dock()).queryByRole('button', { name: 'Manajemen Pasien' }),
    ).not.toBeInTheDocument();
  });

  it('moves a window with the keyboard (arrows) and resizes with Shift+arrows', async () => {
    const user = userEvent.setup();
    renderApp('/workspace');
    await user.click(screen.getByRole('button', { name: /Manajemen Pasien/ }));
    const bar = (await screen.findAllByRole('group', { name: 'Manajemen Pasien' }))[0]!;
    const before = { ...useWindowStore.getState().windows[0]! };
    bar.focus();
    await user.keyboard('{ArrowRight}{ArrowDown}');
    const moved = useWindowStore.getState().windows[0]!;
    expect(moved.x).toBe(before.x + 16);
    expect(moved.y).toBe(before.y + 16);
    await user.keyboard('{Shift>}{ArrowRight}{/Shift}');
    expect(useWindowStore.getState().windows[0]!.w).toBe(before.w + 16);
  });

  it('Alt+1 opens Manajemen Pasien', async () => {
    const user = userEvent.setup();
    renderApp('/workspace');
    await user.keyboard('{Alt>}{1}{/Alt}');
    // userEvent sets e.code from the key for digits
    expect(useWindowStore.getState().windows.map((w) => w.id)).toEqual(['patients']);
  });

  it('patient list filters by name / MRN and by status; rows are keyboard navigable', async () => {
    const user = userEvent.setup();
    renderApp('/workspace');
    await user.click(screen.getByRole('button', { name: /Manajemen Pasien/ }));
    const win = await screen.findByRole('dialog', { name: 'Manajemen Pasien' });
    await user.type(within(win).getByRole('searchbox', { name: 'Cari pasien' }), 'siti');
    expect(within(win).getAllByRole('row')).toHaveLength(2);
    expect(within(win).getByText('Menampilkan 1 dari 8 pasien')).toBeInTheDocument();
    await user.clear(within(win).getByRole('searchbox', { name: 'Cari pasien' }));
    await user.click(within(win).getByRole('radio', { name: 'IGD' }));
    expect(within(win).getAllByRole('row')).toHaveLength(2);
    expect(within(win).getByText('Agus Prasetyo')).toBeInTheDocument();
    await user.type(within(win).getByRole('searchbox', { name: 'Cari pasien' }), 'zzz');
    expect(within(win).getByText('Tidak ada pasien yang cocok.')).toBeInTheDocument();
  });

  it('opens an English UI with translated chrome but untranslated master data', async () => {
    const user = userEvent.setup();
    renderApp('/workspace');
    await user.click(screen.getByRole('button', { name: /Manajemen Pasien/ }));
    await user.click(await screen.findByRole('button', { name: 'Menu pengguna' }));
    await user.click(await screen.findByRole('radio', { name: 'Ganti bahasa ke English' }));
    await user.keyboard('{Escape}'); // close the (modal) popover so the page is no longer aria-hidden
    const win = await screen.findByRole('dialog', { name: 'Patient Management' });
    expect(within(win).getByRole('columnheader', { name: 'MRN' })).toBeInTheDocument();
    expect(within(win).getAllByText('Penyakit Dalam').length).toBeGreaterThan(0); // master data stays as stored
    expect(
      within(screen.getByRole('navigation', { name: 'Open windows' })).getByRole('button', {
        name: 'Home',
      }),
    ).toBeInTheDocument();
  });

  it('logs out from the user menu: session and windows are cleared, login screen with notice', async () => {
    const user = userEvent.setup();
    renderApp('/workspace');
    await user.click(screen.getByRole('button', { name: /Manajemen Pasien/ }));
    await user.click(await screen.findByRole('button', { name: 'Menu pengguna' }));
    await user.click(await screen.findByRole('button', { name: 'Keluar' }));
    expect(await screen.findByRole('button', { name: 'Masuk' })).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Anda telah keluar.');
    expect(useAuthStore.getState().user).toBeNull();
    expect(useWindowStore.getState().windows).toHaveLength(0);
  });
});
