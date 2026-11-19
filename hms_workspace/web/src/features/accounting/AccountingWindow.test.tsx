import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppProviders } from '@/AppProviders';
import { resourceCache } from '@/lib/resource';
import { demoUser } from '@/state/auth';
import { AccountingWindow } from './AccountingWindow';

const ok = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });

/** A balance sheet with one account per group. Synthetic: no figure here comes from the hospital's books. */
const balanceSheet = {
  periode: { tahun: 2026, bulan: 11 },
  aset: {
    baris: [
      { kode: '1.110', nama: 'Kas Bendahara', tipe: 'asset', saldo_normal: 'debit', depth: 2, is_header: false, nilai: 1000 },
      // A contra account arrives negative, and the sign must survive to the screen: it is what makes the column add up.
      { kode: '1.260', nama: 'Akum. Penyusutan', tipe: 'asset', saldo_normal: 'credit', depth: 2, is_header: false, nilai: -400 },
    ],
    total: 600,
  },
  kewajiban: { baris: [], total: 0 },
  ekuitas: { baris: [], total: 600 },
  laba_tahun_lalu: 0,
  laba_rugi_berjalan: 0,
  total_kewajiban_ekuitas: 600,
  selisih: 0,
};

const incomeStatement = {
  periode: { tahun: 2026, bulan: 11 },
  pendapatan: [
    { kode: '4.100', nama: 'Pendapatan Rawat Jalan', tipe: 'revenue', saldo_normal: 'credit', depth: 2, is_header: false, nilai: 900 },
  ],
  hpp: [],
  beban: [],
  biaya_lain: [],
  pajak: [],
  total: {
    pendapatan: 900, hpp: 0, beban: 0, biaya_lain: 0, pajak: 0,
    laba_kotor: 900, laba_operasi: 900, laba_rugi: 900,
  },
};

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
      <AccountingWindow />
    </AppProviders>,
  );
}

describe('AccountingWindow (financial reports)', () => {
  it('needs the live connection and a permission, and asks nothing otherwise', () => {
    const { unmount } = show(['accounting.neraca.read']);
    expect(screen.getByText(/need the live connection/)).toBeInTheDocument();
    unmount();

    vi.stubEnv('VITE_DATA_SOURCE', 'bff');
    show([]);
    expect(screen.getByText(/permission to view financial reports/)).toBeInTheDocument();
    // A session without the permission must not reach the server at all: the refusal is not something to find out
    // from a 403.
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('shows the balance sheet with contra accounts still negative', async () => {
    vi.stubEnv('VITE_DATA_SOURCE', 'bff');
    fetchMock.mockResolvedValue(ok(balanceSheet));

    show(['accounting.neraca.read']);

    expect(await screen.findByText('Kas Bendahara')).toBeInTheDocument();
    expect(screen.getByText('-400.00')).toBeInTheDocument();
    expect(urls()[0]).toContain('/api/v1/accounting/neraca');
  });

  it('offers only the reports the session may read', async () => {
    vi.stubEnv('VITE_DATA_SOURCE', 'bff');
    fetchMock.mockResolvedValue(ok(balanceSheet));

    show(['accounting.neraca.read']);

    await screen.findByText('Kas Bendahara');
    // One permission, one report: no tab for the income statement, and nothing asked for it.
    expect(screen.queryByRole('tab', { name: 'Income statement' })).not.toBeInTheDocument();
    expect(urls().some((u) => u.includes('laba-rugi'))).toBe(false);
  });

  it('switches between the two reports, asking for each in turn', async () => {
    vi.stubEnv('VITE_DATA_SOURCE', 'bff');
    fetchMock.mockImplementation((url: string) =>
      Promise.resolve(ok(url.includes('laba-rugi') ? incomeStatement : balanceSheet)),
    );

    show(['accounting.neraca.read', 'accounting.laba_rugi.read']);

    await screen.findByText('Kas Bendahara');
    await userEvent.click(screen.getByRole('tab', { name: 'Income statement' }));

    expect(await screen.findByText('Pendapatan Rawat Jalan')).toBeInTheDocument();
    expect(urls().some((u) => u.includes('/api/v1/accounting/laba-rugi'))).toBe(true);
  });

  it('asks for the period the person picked', async () => {
    vi.stubEnv('VITE_DATA_SOURCE', 'bff');
    fetchMock.mockResolvedValue(ok(balanceSheet));

    show(['accounting.neraca.read']);
    await screen.findByText('Kas Bendahara');

    const select = screen.getByLabelText('Period') as HTMLSelectElement;
    const other = Array.from(select.options).find((o) => o.value !== select.value);
    await userEvent.selectOptions(select, other!.value);

    const [year, month] = other!.value.split('-');
    expect(urls().some((u) => u.includes(`year=${year}`) && u.includes(`month=${month}`))).toBe(true);
  });
});