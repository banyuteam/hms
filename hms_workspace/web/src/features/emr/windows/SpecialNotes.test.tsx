import { act, configure, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { emrApi } from '@/api/emrApi';
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

describe('Patient Profile · special notes', () => {
  it('shows the allergy written at the last visit, names that visit, and keeps it out of the identity strip', async () => {
    const { win, section } = await openProfile();
    expect(
      await within(section).findByText('Amoxicillin — rash (patient report)'),
    ).toBeInTheDocument();
    expect(
      within(section).getByText(`From the notes of the last visit, ${NR}.`),
    ).toBeInTheDocument();
    expect(within(strip(win)).queryByText(/allerg/i)).toBeNull();
  });

  it('says plainly that no allergy is in this visit’s notes, with no warning in the identity strip', async () => {
    journeyWithoutAllergy();
    const { win, section } = await openProfile();
    expect(
      await within(section).findByText("No allergy recorded in this visit's notes"),
    ).toBeInTheDocument();
    expect(within(section).queryByText(/no known allerg/i)).toBeNull();
    expect(within(strip(win)).queryByText(/allerg/i)).toBeNull();
  });

  it('a last visit that cannot be loaded is an error with Try again, never "not recorded"', async () => {
    const original = emrApi.getJourney.bind(emrApi);
    vi.spyOn(emrApi, 'getJourney')
      .mockRejectedValueOnce(new Error('boom'))
      .mockImplementation((nr) => original(nr));
    const { section } = await openProfile();
    expect(await within(section).findByRole('alert')).toHaveTextContent(
      /could not be loaded, so the allergy note could not be read/,
    );
    expect(within(section).queryByText(/No allergy recorded/)).toBeNull();
    await userEvent.click(within(section).getByRole('button', { name: 'Try again' }));
    expect(
      await within(section).findByText('Amoxicillin — rash (patient report)'),
    ).toBeInTheDocument();
  });

  it('with no visits it says there is nothing to read from', async () => {
    vi.spyOn(emrApi, 'listEncounterPage').mockResolvedValue({ items: [], nextCursor: null });
    const { section } = await openProfile();
    expect(
      await within(section).findByText(/No visits recorded, so there are no notes/),
    ).toBeInTheDocument();
  });
});

describe('encounter windows · identity strip', () => {
  it('shows a recorded allergy, and nothing (no warning) when none was written', async () => {
    renderWindows('employee');
    act(() => homeActions().open('emr-encounter', { norawat: NR }));
    const group = await screen.findByRole('group', { name: 'Patient identity' });
    expect(await within(group).findByText(/^Allergy: Amoxicillin/)).toBeInTheDocument();
  });

  it('does not show an allergy warning in the strip when no allergy was written', async () => {
    journeyWithoutAllergy();
    renderWindows('employee');
    act(() => homeActions().open('emr-encounter', { norawat: NR }));
    const win = await screen.findByRole('region', { name: /^Medical Encounter · / });
    await within(win).findByRole('heading', { name: /CPPT/ });
    expect(within(strip(win)).queryByText(/allerg/i)).toBeNull();
  });
});
