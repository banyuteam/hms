import { act, configure, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { homeActions, renderWindows } from '../test/harness';

configure({ asyncUtilTimeout: 8000 });
afterEach(() => vi.restoreAllMocks());

const NR = '2026/10/26/000123';

describe('printing the bill', () => {
  it('prints only the bill, in a layer of its own, with the patient named by two identifiers', async () => {
    const print = vi.spyOn(window, 'print').mockImplementation(() => {});
    renderWindows('employee');
    act(() => homeActions().open('emr-records', { norawat: '2026/08/14/000045' })); // another window stays open
    act(() => homeActions().open('billing', { norawat: NR, item: 'summary' }));
    const win = await screen.findByRole('region', { name: /^Billing summary · / });
    const doc = await within(win).findByRole('article', { name: 'Billing summary' });
    expect(within(doc).getByText('Siti Nurhaliza')).toBeInTheDocument();
    expect(within(doc).getByText('00012346')).toBeInTheDocument();

    await userEvent.click(within(win).getByRole('button', { name: 'Print' }));
    expect(print).toHaveBeenCalledTimes(1);
    // The print layer sits next to the app (the stylesheet prints only it) and holds the bill alone.
    const layer = document.body.querySelector(':scope > .hms-print-root');
    expect(layer).not.toBeNull();
    expect(layer!.querySelectorAll('article')).toHaveLength(1);
    expect(layer).toHaveTextContent('Siti Nurhaliza');
    expect(layer).not.toHaveTextContent('Medical Records');

    act(() => {
      window.dispatchEvent(new Event('afterprint'));
    });
    expect(document.body.querySelector(':scope > .hms-print-root')).toBeNull();
  });
});
