import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppProviders } from '@/AppProviders';
import { resourceCache } from '@/lib/resource';
import { demoUser } from '@/state/auth';
import { TariffWindow } from './TariffWindow';

const ok = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });

// Synthetic tariff rows (no real prices).
function item(code: string, extra: Record<string, unknown> = {}) {
  return {
    code,
    name: `Konsultasi ${code}`,
    category: { code: 'K01', name: 'Konsultasi' },
    payer: { code: 'UMU', name: 'UMUM' },
    place: { type: 'clinic', code: 'P01', name: 'Poli Umum' },
    class: null,
    unit: null,
    active: true,
    components: [{ name: 'doctor_fee', amount: '50000.00' }],
    prices: [
      { name: 'doctor', amount: '55000.00' },
      { name: 'nurse', amount: '0.00' },
      { name: 'doctor_and_nurse', amount: '55000.00' },
    ],
    ...extra,
  };
}

let fetchMock: ReturnType<typeof vi.fn>;
const urls = () => fetchMock.mock.calls.map((c) => String(c[0]));

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  resourceCache.clear();
});

function show(permissions: string[]) {
  return render(
    <AppProviders
      initialLocale="en"
      initialAuth={{ user: { ...demoUser('employee'), permissions }, notice: null }}
    >
      <TariffWindow winId="w-tariffs" />
    </AppProviders>,
  );
}

describe('TariffWindow (tariff book)', () => {
  it('needs the live connection and the permission, and asks nothing otherwise', () => {
    const { unmount } = show(['tariff.read']);
    expect(screen.getByText(/needs the live connection/)).toBeInTheDocument();
    unmount();
    vi.stubEnv('VITE_DATA_SOURCE', 'bff');
    show([]);
    expect(screen.getByText(/permission to view the tariff book/)).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('lists a kind with only its own filters, pages with next_after and shows details', async () => {
    vi.stubEnv('VITE_DATA_SOURCE', 'bff');
    fetchMock
      .mockResolvedValueOnce(
        ok({ kind: 'outpatient_procedure', items: [item('RJ001')], next_after: 'RJ001' }),
      )
      .mockResolvedValueOnce(ok({ kind: 'outpatient_procedure', items: [item('RJ002')] }));
    show(['tariff.read']);
    expect(await screen.findByText('Konsultasi RJ001')).toBeInTheDocument();
    expect(urls()[0]).toBe('/api/v1/tariffs/outpatient_procedure?status=active&limit=50');
    expect(screen.getByLabelText('Payer code')).toBeInTheDocument();
    expect(screen.getByLabelText('Clinic code')).toBeInTheDocument();
    expect(screen.queryByLabelText('Class')).toBeNull(); // outpatient tariffs have no class
    const row = screen.getByText('Konsultasi RJ001').closest('tr')!;
    expect(row.textContent).toMatch(/Doctor: .*55,000/);

    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Load more' }));
    expect(await screen.findByText('Konsultasi RJ002')).toBeInTheDocument();
    expect(urls()[1]).toContain('after=RJ001');
    expect(screen.queryByRole('button', { name: 'Load more' })).toBeNull();

    await user.click(screen.getByRole('button', { name: 'Details of tariff RJ001' }));
    const details = screen.getByRole('region', { name: 'Details of tariff RJ001' });
    expect(within(details).getByText('Doctor fee')).toBeInTheDocument();
    expect(within(details).getByText('Doctor and nurse')).toBeInTheDocument();
  });

  it('sends the filters a kind has, and lists the priced items of a laboratory test', async () => {
    vi.stubEnv('VITE_DATA_SOURCE', 'bff');
    fetchMock.mockImplementation((url: string) => {
      if (url.includes('/items'))
        return Promise.resolve(
          ok({
            code: 'LAB01',
            truncated: false,
            items: [
              {
                template_id: 11,
                name: 'Hemoglobin',
                unit: 'g/dL',
                components: [],
                price: '5000.00',
              },
            ],
          }),
        );
      if (url.includes('/laboratory'))
        return Promise.resolve(
          ok({
            kind: 'laboratory',
            items: [
              item('LAB01', {
                name: 'Darah lengkap',
                place: null,
                class: 'Kelas 1',
                prices: [{ name: 'total', amount: '80000.00' }],
              }),
            ],
          }),
        );
      return Promise.resolve(ok({ kind: 'outpatient_procedure', items: [] }));
    });
    show(['tariff.read']);
    const user = userEvent.setup();
    expect(await screen.findByText('No tariffs match.')).toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText('Tariff'), 'laboratory');
    await user.selectOptions(screen.getByLabelText('Class'), 'Kelas 1');
    expect(await screen.findByText('Darah lengkap')).toBeInTheDocument();
    // The class filter is sent after the typing debounce.
    await waitFor(() =>
      expect(urls().some((u) => u.includes('/tariffs/laboratory?class=Kelas+1'))).toBe(true),
    );
    expect(screen.queryByLabelText('Clinic code')).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Details of tariff LAB01' }));
    expect(await screen.findByText('Hemoglobin')).toBeInTheDocument();
    expect(urls()).toContain('/api/v1/tariffs/laboratory/LAB01/items');
  });

  it('a failed list offers Try again; a refusal is final', async () => {
    vi.stubEnv('VITE_DATA_SOURCE', 'bff');
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: { code: 'service_unavailable' } }), { status: 503 }),
    );
    const { unmount } = show(['tariff.read']);
    expect(await screen.findByText('The tariffs could not be loaded.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
    unmount();
    resourceCache.clear();
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: { code: 'forbidden' } }), { status: 403 }),
    );
    show(['tariff.read']);
    expect(await screen.findByText(/permission to view the tariff book/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull();
  });
});
