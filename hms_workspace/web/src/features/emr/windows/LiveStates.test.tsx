import { act, configure, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { emrApi } from '@/api/emrApi';
import { ApiError } from '@/api/liveApi';
import { patientApi } from '@/api/patientApi';
import { homeActions, renderWindows } from '../test/harness';

configure({ asyncUtilTimeout: 8000 });
afterEach(() => vi.restoreAllMocks());

describe('live-data states of the EMR windows', () => {
  it('a visit window the server refuses says which access is missing, without a Retry', async () => {
    vi.spyOn(emrApi, 'getJourney').mockRejectedValue(new ApiError(403, 'forbidden'));
    renderWindows('employee');
    act(() => homeActions().open('emr-records', { norawat: '2026/10/26/000123' }));
    const message = await screen.findByText(/permission to view the clinical record of visits/);
    const state = message.closest('[role="alert"]') ?? message.parentElement!;
    expect(
      within(state as HTMLElement).queryByRole('button', { name: /Try again|Retry/ }),
    ).toBeNull();
  });

  it('a profile the server refuses says so (no permission), without a Retry', async () => {
    vi.spyOn(patientApi, 'getPatientProfile').mockRejectedValue(new ApiError(403, 'forbidden'));
    vi.spyOn(emrApi, 'listEncounterPage').mockResolvedValue({ items: [], nextCursor: null });
    renderWindows('employee');
    act(() => homeActions().open('emr-profile', { mrn: '000001' }));
    const message = await screen.findByText(/You do not have permission to view patient records/);
    const state = message.closest('[role="alert"]') ?? message.parentElement!;
    expect(
      within(state as HTMLElement).queryByRole('button', { name: /Try again|Retry/ }),
    ).toBeNull();
  });
});
