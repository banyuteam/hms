import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import enEmr from '@/locales/en/emr.json';
import { renderApp } from '@/test/utils';

describe('Home', () => {
  it('shows search first, four task cards and the assistant card — no viewers, no "Soon" tiles', async () => {
    renderApp('/', { role: 'employee' });
    expect(await screen.findByLabelText(/find patient \(name, mrn\)/i)).toBeInTheDocument();
    const start = screen.getByRole('heading', { name: 'Start' }).parentElement!;
    const cards = within(start).getAllByRole('button');
    expect(cards.map((b) => b.textContent)).toEqual([
      expect.stringContaining('Patient Profile'),
      expect.stringContaining('Medical Records'),
      expect.stringContaining('Medical Encounter'),
      expect.stringContaining('Diagnostics & Pharmacy'),
      expect.stringContaining('Open assistant'),
    ]);
    expect(screen.queryByText(/billing/i)).toBeNull();
    expect(screen.queryByText('Soon')).toBeNull();
    // Same role label on the Home pill and in the dock.
    expect(screen.getAllByText('Employee · view only')).toHaveLength(2);
  });

  it('opens the docked assistant from the assistant card', async () => {
    renderApp('/', { role: 'doctor' });
    const start = (await screen.findByRole('heading', { name: 'Start' })).parentElement!;
    const card = within(start).getAllByRole('button').at(-1)!;
    await userEvent.click(card);
    expect(screen.getByRole('complementary', { name: enEmr['emr.ai.title'] })).toBeInTheDocument();
  });

  it('opening a task card lists nothing under "open records" until a record is chosen', async () => {
    renderApp('/', { role: 'doctor' });
    const start = (await screen.findByRole('heading', { name: 'Start' })).parentElement!;
    await userEvent.click(within(start).getAllByRole('button')[1]!);
    expect(screen.queryByRole('heading', { name: /open/i, level: 2 })).toBeNull();
  });
});
