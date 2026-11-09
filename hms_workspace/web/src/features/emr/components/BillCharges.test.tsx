import { render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AppProviders } from '@/AppProviders';
import { emrApi } from '@/api/emrApi';
import { ApiError } from '@/api/liveApi';
import type { EncounterBill } from '@/api/liveTimeline';
import { resourceCache } from '@/lib/resource';
import { demoUser } from '@/state/auth';
import { BillCharges } from './BillCharges';

const NR = '2026/10/26/000123';

// Synthetic bill (no real data).
const BILL: EncounterBill = {
  encounter_number: NR,
  currency: 'IDR',
  basis: 'recorded_charges',
  care_setting: 'inpatient',
  groups: [
    {
      category: 'room',
      legacy_category: 'Kamar',
      subtotal: '1400000.00',
      lines: [
        {
          code: 'VIP.01',
          label: 'Melati',
          quantity: '4.00',
          unit_price: '350000.00',
          additional: '0.00',
          amount: '1400000.00',
          rate_percent: null,
          tariff: null,
          tariff_matches: null,
        },
      ],
    },
    {
      category: 'medication',
      legacy_category: 'Obat',
      subtotal: '6000.00',
      lines: [
        {
          code: 'B001',
          label: 'Parasetamol 500',
          quantity: '10.00',
          unit_price: '500.00',
          additional: '1000.00',
          amount: '6000.00',
          rate_percent: null,
          tariff: '450.00',
          tariff_matches: false,
        },
      ],
    },
    {
      category: 'discount',
      legacy_category: 'Potongan',
      subtotal: '-50000.00',
      lines: [
        {
          code: '',
          label: 'Diskon karyawan',
          quantity: '1',
          unit_price: '-50000.00',
          additional: '0.00',
          amount: '-50000.00',
          rate_percent: null,
          tariff: null,
          tariff_matches: null,
        },
      ],
    },
    {
      category: 'service',
      legacy_category: 'Service',
      subtotal: '140600.00',
      lines: [
        {
          code: '',
          label: 'Jasa layanan',
          quantity: '1',
          unit_price: '1406000.00',
          additional: '0.00',
          amount: '140600.00',
          rate_percent: '10',
          tariff: null,
          tariff_matches: null,
        },
      ],
    },
  ],
  total: '1496600.00',
  saved_bill: {
    bill_number: 'RI2026/0001',
    billed_at: '2026-10-30T14:00:00+07:00',
    care_setting: 'inpatient',
  },
  payments: [{ method: 'TUNAI', amount: '1406000.00', tax: '' }],
  receivable: null,
  truncated: [],
};

function show(permissions: string[]) {
  return render(
    <AppProviders
      initialLocale="en"
      initialAuth={{ user: { ...demoUser('employee'), permissions }, notice: null }}
    >
      <BillCharges norawat={NR} />
    </AppProviders>,
  );
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  resourceCache.clear();
});

describe('BillCharges (charges in the billing document)', () => {
  it('synthetic data has no bills: says so and asks nothing', () => {
    const get = vi.spyOn(emrApi, 'getBill');
    show(['billing.read']);
    expect(screen.getByText('Not available from source')).toBeInTheDocument();
    expect(get).not.toHaveBeenCalled();
  });

  it('without billing.read it says so and sends no request', () => {
    vi.stubEnv('VITE_DATA_SOURCE', 'bff');
    const get = vi.spyOn(emrApi, 'getBill');
    show(['encounter.clinical.read']);
    expect(screen.getByText('You do not have permission to view bills.')).toBeInTheDocument();
    expect(get).not.toHaveBeenCalled();
  });

  it('shows the charges by category with the server subtotals and total', async () => {
    vi.stubEnv('VITE_DATA_SOURCE', 'bff');
    vi.spyOn(emrApi, 'getBill').mockResolvedValue(BILL);
    show(['billing.read']);
    expect(await screen.findByText('Parasetamol 500')).toBeInTheDocument();
    expect(screen.getByText('Room')).toBeInTheDocument();
    expect(screen.getByText('Drugs and supplies')).toBeInTheDocument();
    const subtotal = screen.getByText('Subtotal Room').closest('tr')!;
    expect(subtotal.textContent).toMatch(/1,400,000/);
    const total = screen.getByText('Total charges').closest('tr')!;
    expect(within(total).getByText(/1,496,600/).tagName).toBe('STRONG');
    const service = screen.getByText('Jasa layanan').closest('tr')!;
    expect(service.textContent).toMatch(/10%/); // the rate, in the quantity column
    expect(service.textContent).toMatch(/1,406,000/); // the base, as unit price
    expect(service.textContent).toMatch(/140,600/);
    expect(screen.getByText('Discounts')).toBeInTheDocument();
    expect(screen.getByText('Diskon karyawan').closest('tr')!.textContent).toMatch(/-.*50,000/);
    const drug = screen.getByText('Parasetamol 500').closest('tr')!;
    expect(drug.textContent).toMatch(/B001/);
    expect(drug.textContent).toMatch(/1,000/); // embalase + tuslah
    expect(drug.textContent).toMatch(/450.*differs/); // today's tariff, with the difference said in words
    expect(screen.getByText(/a difference is not necessarily an error/)).toBeInTheDocument();
    const room = screen.getByText('Melati').closest('tr')!;
    expect(room.textContent).not.toMatch(/differs/);
    expect(screen.getByText(/No\. RI2026\/0001, saved 30 Oct 2026 14:00/)).toBeInTheDocument();
    expect(screen.getByText(/TUNAI: /)).toBeInTheDocument();
    expect(
      screen.getByText(/service fee is calculated from the legacy service settings/),
    ).toBeInTheDocument();
  });

  it('a visit without charges or a saved bill says both', async () => {
    vi.stubEnv('VITE_DATA_SOURCE', 'bff');
    vi.spyOn(emrApi, 'getBill').mockResolvedValue({
      ...BILL,
      groups: [],
      total: '0.00',
      saved_bill: null,
      payments: [],
    });
    show(['billing.read']);
    expect(await screen.findByText('No charges are recorded for this visit.')).toBeInTheDocument();
    expect(
      screen.getByText('The cashier has not saved a bill for this visit yet.'),
    ).toBeInTheDocument();
  });

  it('says the total is incomplete when a section hit its cap', async () => {
    vi.stubEnv('VITE_DATA_SOURCE', 'bff');
    vi.spyOn(emrApi, 'getBill').mockResolvedValue({ ...BILL, truncated: ['charge_medication'] });
    show(['billing.read']);
    expect(await screen.findByText(/the total is incomplete/)).toBeInTheDocument();
  });

  it('a refusal is final; a failure offers Try again', async () => {
    vi.stubEnv('VITE_DATA_SOURCE', 'bff');
    vi.spyOn(emrApi, 'getBill').mockRejectedValueOnce(new ApiError(403, 'forbidden'));
    const { unmount } = show(['billing.read']);
    expect(
      await screen.findByText('You do not have permission to view bills.'),
    ).toBeInTheDocument();
    unmount();
    resourceCache.clear();
    vi.spyOn(emrApi, 'getBill').mockRejectedValueOnce(new ApiError(503, 'service_unavailable'));
    show(['billing.read']);
    expect(await screen.findByText('The bill could not be loaded.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
  });

  it('an amount, quantity or date that is not valid is flagged as a data problem, not shown as "—"', async () => {
    vi.stubEnv('VITE_DATA_SOURCE', 'bff');
    const line = BILL.groups[0]!.lines[0]!;
    vi.spyOn(emrApi, 'getBill').mockResolvedValue({
      ...BILL,
      groups: [
        {
          ...BILL.groups[0]!,
          lines: [{ ...line, unit_price: '1.406.000', quantity: 'x', rate_percent: null }],
        },
      ],
      saved_bill: { ...BILL.saved_bill!, billed_at: 'yesterday' },
    });
    show(['billing.read']);
    const table = await screen.findByRole('table');
    expect(within(table).getByText('Invalid amount in source: “1.406.000”')).toBeInTheDocument();
    expect(within(table).getByText('Invalid number in source: “x”')).toBeInTheDocument();
    expect(screen.getByText(/Invalid date in source: “yesterday”/)).toBeInTheDocument();
  });

  it('a malformed answer says the data cannot be read safely', async () => {
    vi.stubEnv('VITE_DATA_SOURCE', 'bff');
    vi.spyOn(emrApi, 'getBill').mockRejectedValue(new ApiError(502, 'BAD_SHAPE'));
    show(['billing.read']);
    expect(await screen.findByText(/sent data this screen cannot read safely/)).toBeInTheDocument();
  });
});
