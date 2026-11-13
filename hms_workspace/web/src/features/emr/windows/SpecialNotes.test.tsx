import { act, configure, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { emrApi } from '@/api/emrApi';
import { ApiError } from '@/api/liveApi';
import type { EncounterJourney } from '@/api/journey';
import { homeActions, renderWindows } from '../test/harness';

configure({ asyncUtilTimeout: 8000 });
afterEach(() => vi.restoreAllMocks());

const MRN = '00012346';
const NR = '2026/10/26/000123';

/** The synthetic journey with every allergy text (CPPT notes, discharge summary) emptied. */
function journeyWithoutAllergy() {
  const original = emrApi.getJourney.bind(emrApi);
  vi.spyOn(emrApi, 'getJourney').mockImplementation(async (norawat) => {
    const j = await original(norawat);
    return JSON.parse(JSON.stringify(j), (_key, v: unknown) =>
      v && typeof v === 'object' && 'alergi' in v ? { ...v, alergi: '' } : v,
    ) as EncounterJourney;
  });
}

async function openProfile() {
  renderWindows('employee');
  act(() => homeActions().open('emr-profile', { mrn: MRN }));
  const win = await screen.findByRole('region', { name: /Patient Profile/ });
  const heading = await within(win).findByRole('heading', { name: 'Special notes' });
  return { win, section: heading.closest('section')! };
}

const strip = (win: HTMLElement) => within(win).getByRole('group', { name: 'Patient identity' });

const noAllergies = () =>
  vi.spyOn(emrApi, 'getPatientAllergies').mockResolvedValue({ entries: [], truncated: false });

// Owner decision 2026-11-10 (replaces 2026-11-09): allergies are patient-level (every visit) and always stated in the
// identity strip — recorded, "not recorded", or "could not be loaded"; never silence that reads as "no allergy".
describe('Patient Profile · special notes', () => {
  it('lists every allergy text written on any visit, with where and when it was last written', async () => {
    const { win, section } = await openProfile();
    expect(
      await within(section).findByText('Amoxicillin — rash (patient report)'),
    ).toBeInTheDocument();
    // A different spelling in the discharge summary is its own entry (texts are never merged or interpreted).
    expect(within(section).getByText('Amoxicillin')).toBeInTheDocument();
    expect(
      within(section).getByText(/inpatient CPPT · visit 2026\/10\/26\/000123 · recorded 5×/),
    ).toBeInTheDocument();
    expect(
      within(section).getByText(/^discharge summary · visit .* · undated/),
    ).toBeInTheDocument();
    expect(await within(strip(win)).findByText(/^Allergy: Amoxicillin — rash/)).toBeInTheDocument();
  });

  it('nothing written on any visit: the profile says "not recorded" (never "no known allergy"); the strip shows nothing', async () => {
    noAllergies();
    const { win, section } = await openProfile();
    expect(await within(section).findByText(/^Not recorded on any visit/)).toBeInTheDocument();
    expect(within(win).queryByText(/no known allerg/i)).toBeNull();
    // Owner decision 2026-11-11: no "not recorded" pill in the strip, and no empty context list left behind.
    expect(within(strip(win)).queryByText(/allerg/i)).toBeNull();
    expect(within(strip(win)).queryByRole('list', { name: 'Visit context and safety' })).toBeNull();
  });

  it('an allergy list that cannot be loaded is an error with Try again, never "not recorded"', async () => {
    const original = emrApi.getPatientAllergies.bind(emrApi);
    vi.spyOn(emrApi, 'getPatientAllergies')
      .mockRejectedValueOnce(new Error('boom'))
      .mockImplementation((mrn) => original(mrn));
    const { win, section } = await openProfile();
    expect(await within(section).findByRole('alert')).toHaveTextContent(
      /Allergy notes could not be loaded/,
    );
    // The strip shows no warning for it, and never "not recorded" either.
    expect(within(strip(win)).queryByText(/allerg/i)).toBeNull();
    expect(within(win).queryByText(/not recorded \(not the same/)).toBeNull();
    await userEvent.click(within(section).getByRole('button', { name: 'Try again' }));
    expect(
      await within(section).findByText('Amoxicillin — rash (patient report)'),
    ).toBeInTheDocument();
  });

  it('without clinical access the strip shows no allergy state and the profile says why', async () => {
    vi.spyOn(emrApi, 'getPatientAllergies').mockRejectedValue(new ApiError(403, 'forbidden'));
    const { win, section } = await openProfile();
    expect(
      await within(section).findByText(/do not have permission to view clinical notes/),
    ).toBeInTheDocument();
    expect(within(strip(win)).queryByText(/allerg/i)).toBeNull();
  });

  it('says when the list may be incomplete', async () => {
    vi.spyOn(emrApi, 'getPatientAllergies').mockResolvedValue({
      entries: [
        {
          text: 'Latex',
          lastRecorded: '2026-01-02 08:00:00',
          lastEncounter: '2026/01/02/000001',
          source: 'clinical_note_outpatient',
          timesRecorded: 1,
        },
      ],
      truncated: true,
    });
    const { win, section } = await openProfile();
    expect(await within(section).findByText(/the oldest are not shown/)).toBeInTheDocument();
    expect(within(strip(win)).getByText('Allergy list may be incomplete')).toBeInTheDocument();
  });
});

describe('encounter windows · identity strip', () => {
  it('shows an allergy written at another visit even when this visit has none', async () => {
    journeyWithoutAllergy(); // this visit's notes are empty; the patient-level list still has the earlier entries
    renderWindows('employee');
    act(() => homeActions().open('emr-encounter', { norawat: NR }));
    const group = await screen.findByRole('group', { name: 'Patient identity' });
    expect(await within(group).findByText(/^Allergy: Amoxicillin/)).toBeInTheDocument();
  });

  it('shows no allergy pill when no allergy is written on any visit (owner decision 2026-11-11)', async () => {
    journeyWithoutAllergy();
    noAllergies();
    renderWindows('employee');
    act(() => homeActions().open('emr-encounter', { norawat: NR }));
    const win = await screen.findByRole('region', { name: /^Medical Encounter · / });
    // The visit context is there and "Loading allergy notes…" has gone: loaded, and nothing is said about allergies.
    expect(await within(strip(win)).findByText(/^DPJP:/)).toBeInTheDocument();
    await waitFor(() => expect(within(strip(win)).queryByText(/allerg/i)).toBeNull());
  });
});
