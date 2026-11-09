import { act, configure, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { emrApi, type EncounterPage } from '@/api/emrApi';
import type { EncounterListItem } from '@/api/journey';
import { homeActions, renderWindows } from '../test/harness';

configure({ asyncUtilTimeout: 8000 });

const visit = (n: number, kd_pj?: string): EncounterListItem => ({
  no_rawat: `2026/10/${String(30 - n).padStart(2, '0')}/00000${n}`,
  no_reg: '001',
  no_rkm_medis: '00012346',
  tgl_registrasi: `2026-10-${String(30 - n).padStart(2, '0')}`,
  jam_reg: '09:00:00',
  status_lanjut: 'Ralan',
  stts: 'Sudah',
  kd_pj,
});
const page = (items: EncounterListItem[], nextCursor: string | null): EncounterPage => ({
  items,
  nextCursor,
});

afterEach(() => vi.restoreAllMocks());

async function openProfile() {
  renderWindows('employee');
  act(() => homeActions().open('emr-profile', { mrn: '00012346' }));
  return screen.findByRole('region', { name: /Patient Profile/ });
}
const rows = () => screen.queryAllByRole('button', { name: /Open medi/i });

describe('Patient Profile · visits paging', () => {
  it('loads the next, older page on request and never lists a visit twice', async () => {
    const spy = vi
      .spyOn(emrApi, 'listEncounterPage')
      .mockResolvedValueOnce(page([visit(1), visit(2)], 'c1'))
      .mockResolvedValueOnce(page([visit(2), visit(3)], null)); // visit 2 repeated by the source
    const user = userEvent.setup();
    const win = await openProfile();

    expect(await within(win).findByText(/2 visits shown · more are available/)).toBeInTheDocument();
    expect(rows()).toHaveLength(2);
    expect(spy).toHaveBeenCalledWith('00012346', undefined);

    await user.click(within(win).getByRole('button', { name: 'Load more visits' }));
    expect(await within(win).findByText(/^3 visits shown$/)).toBeInTheDocument();
    expect(rows()).toHaveLength(3);
    expect(spy).toHaveBeenLastCalledWith('00012346', 'c1');
    expect(within(win).queryByRole('button', { name: /Load more visits/ })).not.toBeInTheDocument();
  });

  // Relies on `isFetchNextPageError` of useInfiniteResource (src/lib/resource.ts).
  it('a failed next page keeps the visits already shown, says so, and can be retried', async () => {
    vi.spyOn(emrApi, 'listEncounterPage')
      .mockResolvedValueOnce(page([visit(1)], 'c1'))
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce(page([visit(2)], null));
    const user = userEvent.setup();
    const win = await openProfile();
    await within(win).findByText(/1 visit shown/);

    await user.click(within(win).getByRole('button', { name: 'Load more visits' }));
    expect(await within(win).findByText(/More visits could not be loaded/)).toBeInTheDocument();
    expect(rows()).toHaveLength(1); // nothing lost
    expect(within(win).queryByText('No visits recorded.')).not.toBeInTheDocument();

    await user.click(within(win).getByRole('button', { name: 'Load more visits' }));
    expect(await within(win).findByText(/^2 visits shown$/)).toBeInTheDocument();
    expect(within(win).queryByText(/More visits could not be loaded/)).not.toBeInTheDocument();
  });

  it('a failed next page keeps the visits already shown and can be retried', async () => {
    vi.spyOn(emrApi, 'listEncounterPage')
      .mockResolvedValueOnce(page([visit(1)], 'c1'))
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce(page([visit(2)], null));
    const user = userEvent.setup();
    const win = await openProfile();
    await within(win).findByText(/1 visit shown/);

    await user.click(within(win).getByRole('button', { name: 'Load more visits' }));
    expect(await within(win).findByRole('button', { name: 'Load more visits' })).toBeEnabled();
    expect(rows()).toHaveLength(1); // nothing lost
    expect(within(win).queryByText('No visits recorded.')).not.toBeInTheDocument();

    await user.click(within(win).getByRole('button', { name: 'Load more visits' }));
    expect(await within(win).findByText(/^2 visits shown$/)).toBeInTheDocument();
  });

  it('a failed first page is an error with Try again, never "No visits recorded"', async () => {
    vi.spyOn(emrApi, 'listEncounterPage')
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce(page([visit(1)], null));
    const user = userEvent.setup();
    const win = await openProfile();

    expect(await within(win).findByText(/Visits could not be loaded/)).toBeInTheDocument();
    expect(within(win).queryByText('No visits recorded.')).not.toBeInTheDocument();
    await user.click(within(win).getByRole('button', { name: 'Try again' }));
    expect(await within(win).findByText(/1 visit shown/)).toBeInTheDocument();
  });

  it('shows "No visits recorded." only when the source really returned none', async () => {
    vi.spyOn(emrApi, 'listEncounterPage').mockResolvedValue(page([], null));
    const win = await openProfile();
    expect(await within(win).findByText('No visits recorded.')).toBeInTheDocument();
  });

  it('shows the payer code as stored on each visit, and nothing for a "-" placeholder', async () => {
    vi.spyOn(emrApi, 'listEncounterPage').mockResolvedValue(
      page([visit(1, 'BPJ'), visit(2, '-'), visit(3)], null),
    );
    const win = await openProfile();
    await within(win).findByText(/3 visits shown/);
    expect(within(win).getAllByText(/Payer BPJ/)).toHaveLength(1);
    expect(within(win).queryByText(/Payer -/)).not.toBeInTheDocument();
  });
});
