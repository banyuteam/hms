import { act, configure, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { emrApi } from '@/api/emrApi';
import { patientApi } from '@/api/patientApi';
import { homeActions, renderWindows } from '../test/harness';

configure({ asyncUtilTimeout: 8000 });

afterEach(() => vi.restoreAllMocks());

async function openSearch() {
  renderWindows('employee');
  act(() => homeActions().open('emr-records'));
  return screen.findByRole('searchbox', {
    name: /find visit by no_rawat, patient name or no_rkm_medis/i,
  });
}

describe('RecordSearch: loading and error states', () => {
  it('sends one patient request for a burst of typing (debounced), not one per key', async () => {
    const spy = vi.spyOn(patientApi, 'listPatients');
    const input = await openSearch();
    await userEvent.type(input, 'Siti');
    await screen.findByRole('list', { name: /siti nurhaliza/i });
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith({ query: 'Siti' });
  });

  it('shows "Searching…" while the patient lookup is pending, never "No matches"', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const real = patientApi.listPatients;
    vi.spyOn(patientApi, 'listPatients').mockImplementation(async (p) => {
      await gate;
      return real(p);
    });
    const input = await openSearch();
    await userEvent.type(input, 'Siti');
    expect(await screen.findByText('Searching…')).toBeInTheDocument();
    expect(screen.queryByText('No matches.')).not.toBeInTheDocument();
    await act(async () => release());
    await screen.findByRole('list', { name: /siti nurhaliza/i });
    expect(screen.queryByText('Searching…')).not.toBeInTheDocument();
  });

  it('reports a failed patient lookup as an error, not as "No matches", and Try again recovers', async () => {
    const spy = vi.spyOn(patientApi, 'listPatients').mockRejectedValueOnce(new Error('boom'));
    const input = await openSearch();
    await userEvent.type(input, 'Siti');
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('The search could not be completed');
    expect(screen.queryByText('No matches.')).not.toBeInTheDocument();

    await userEvent.click(within(alert).getByRole('button', { name: 'Try again' }));
    await screen.findByRole('list', { name: /siti nurhaliza/i });
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it('still shows the visit hits when only the patient lookup fails', async () => {
    vi.spyOn(patientApi, 'listPatients').mockRejectedValue(new Error('boom'));
    const input = await openSearch();
    await userEvent.type(input, '2026/10/26');
    await screen.findByRole('alert');
    expect(await screen.findByText(/2026\/10\/26\/000123/)).toBeInTheDocument();
  });

  it('reports failed visit loading under a patient as an error, never as "No visits recorded"', async () => {
    vi.spyOn(emrApi, 'listEncounters').mockRejectedValueOnce(new Error('boom'));
    const input = await openSearch();
    await userEvent.type(input, 'Siti');
    const list = await screen.findByText('Visits could not be loaded.');
    expect(list).toBeInTheDocument();
    expect(screen.queryByText('No visits recorded.')).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await waitFor(() =>
      expect(screen.queryByText('Visits could not be loaded.')).not.toBeInTheDocument(),
    );
    expect(await screen.findByRole('list', { name: /siti nurhaliza/i })).toBeInTheDocument();
  });

  it('Escape clears the search box', async () => {
    const input = await openSearch();
    await userEvent.type(input, 'Siti{Escape}');
    expect(input).toHaveValue('');
  });

  it('emrApi.findPatients goes through patientApi and needs at least 2 characters', async () => {
    const spy = vi.spyOn(patientApi, 'listPatients');
    expect(await emrApi.findPatients(' s ')).toEqual([]);
    expect(spy).not.toHaveBeenCalled();
    expect(await emrApi.findPatients('00012346')).toEqual([
      { mrn: '00012346', name: 'Siti Nurhaliza', sex: 'female', birthDate: '1985-10-02' },
    ]);
  });
});

describe('RecordSearch: matching and hints', () => {
  it('finds a patient with the words in any order and extra spaces', async () => {
    const input = await openSearch();
    await userEvent.type(input, 'nurhaliza   siti');
    expect(await screen.findByRole('list', { name: /siti nurhaliza/i })).toBeInTheDocument();
  });

  it('shows date of birth and sex next to the name, so two patients with the same name can be told apart', async () => {
    const input = await openSearch();
    await userEvent.type(input, 'siti nurhaliza');
    expect(
      (await screen.findAllByText(/MRN 00012346 · Born 02 Oct 1985 \(\d+ y\) · Female/))[0],
    ).toBeInTheDocument();
  });

  it('asks for 2 characters for a patient (not a visit-number hint) and says "No matches" from 2', async () => {
    const input = await openSearch();
    await userEvent.type(input, 'q');
    expect(
      await screen.findByText(
        'Type at least 2 characters to find a patient (3 for a visit number).',
      ),
    ).toBeInTheDocument();
    await userEvent.type(input, 'x');
    expect(await screen.findByText('No matches.')).toBeInTheDocument();
    expect(screen.queryByText(/Type at least/)).not.toBeInTheDocument();
  });
});
