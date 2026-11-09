import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppProviders } from '@/AppProviders';
import { revealIdentifier } from '@/api/livePatientApi';
import type { MaskedText } from '@/api/types';
import { AuditSubjectProvider } from '@/audit/subject';
import { MaskedValue } from './MaskedValue';

// Synthetic values only.
const NIK = { value: '3273010210850002', masked: '3273••••••••0002' };
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  fetchMock = vi.fn(async () => json({}, 404));
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

function renderNik(text: MaskedText = NIK) {
  render(
    <AppProviders initialLocale="en">
      <AuditSubjectProvider patient="000001" encounter="2026/10/26/000123">
        <MaskedValue field="nik" label="NIK" text={text} />
      </AuditSubjectProvider>
    </AppProviders>,
  );
}

/** Live data: the browser holds only the mask; the value comes from the server on request (audited there). */
const LIVE_NIK: MaskedText = {
  value: '',
  masked: NIK.masked,
  reveal: () => revealIdentifier('000001', 'nik'),
};

describe('MaskedValue reveal and audit', () => {
  it('live: asks the server for the value, shows it, and drops it again when hidden', async () => {
    vi.stubEnv('VITE_DATA_SOURCE', 'bff');
    fetchMock.mockImplementation(async () => json({ value: NIK.value }));
    const user = userEvent.setup();
    renderNik(LIVE_NIK);
    expect(screen.queryByText(NIK.value)).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Reveal NIK' }));
    expect(await screen.findByText(NIK.value)).toBeInTheDocument();
    expect(fetchMock.mock.calls[0]![0]).toBe('/api/v1/patients/000001/identifiers/nik');
    await user.click(screen.getByRole('button', { name: 'Hide NIK' }));
    await waitFor(() => expect(screen.queryByText(NIK.value)).not.toBeInTheDocument());
    // Showing it again asks (and is audited) again: nothing was kept.
    await user.click(screen.getByRole('button', { name: 'Reveal NIK' }));
    await screen.findByText(NIK.value);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('live: says when the person may not reveal it', async () => {
    vi.stubEnv('VITE_DATA_SOURCE', 'bff');
    fetchMock.mockImplementation(async () => json({ error: { code: 'forbidden' } }, 403));
    const user = userEvent.setup();
    renderNik(LIVE_NIK);
    await user.click(screen.getByRole('button', { name: 'Reveal NIK' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'You do not have permission to reveal this value.',
    );
    expect(screen.getByText(NIK.masked)).toBeInTheDocument();
  });

  it('live: keeps the value hidden when the server could not record the reveal', async () => {
    vi.stubEnv('VITE_DATA_SOURCE', 'bff');
    fetchMock.mockImplementation(async () => json({ error: { code: 'service_unavailable' } }, 503));
    const user = userEvent.setup();
    renderNik(LIVE_NIK);
    await user.click(screen.getByRole('button', { name: 'Reveal NIK' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Not recorded, so the value stays hidden.',
    );
    expect(screen.queryByText(NIK.value)).not.toBeInTheDocument();
  });

  it('demo: reveals at once, records in memory only, sends nothing', async () => {
    const user = userEvent.setup();
    renderNik();
    await user.click(screen.getByRole('button', { name: 'Reveal NIK' }));
    expect(await screen.findByText(NIK.value)).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Hide NIK' }));
    await waitFor(() => expect(screen.queryByText(NIK.value)).not.toBeInTheDocument());
  });
});
