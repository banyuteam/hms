import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/api/liveApi';
import { NotFoundError } from '@/api/patientApi';
import { SYNTHETIC_CLAIM_EVALUATIONS } from '@/data/claimFixtures';
import { claimApi, claimErrorKind, liveClaimApi, parseEvaluation } from './claimApi';
import { viewFinding } from '@/features/assistant/claimView';

afterEach(() => vi.restoreAllMocks());

const NR = '2026/10/26/000123';
const answer = () => structuredClone(SYNTHETIC_CLAIM_EVALUATIONS[NR]!);
const t = (id: string) => id;

describe('claim readiness client', () => {
  it('accepts an answer in the contract shape for the visit asked about', () => {
    expect(parseEvaluation(answer(), NR).findings).toHaveLength(9);
  });

  it.each([
    [
      'another visit',
      (a: Record<string, unknown>) => ({
        ...a,
        reference: { resource_type: 'encounter', resource_id: 'x' },
      }),
    ],
    [
      'an unknown result',
      (a: Record<string, unknown>) => ({
        ...a,
        findings: [{ ...(a.findings as object[])[0], result: 'ok' }],
      }),
    ],
    ['an unknown status', (a: Record<string, unknown>) => ({ ...a, status: 'valid' })],
    ['no findings list', (a: Record<string, unknown>) => ({ ...a, findings: undefined })],
  ])('rejects %s as BAD_SHAPE', (_name, change) => {
    expect(() =>
      parseEvaluation(change(answer() as unknown as Record<string, unknown>), NR),
    ).toThrow(expect.objectContaining({ code: 'BAD_SHAPE' }));
  });

  it('demo data: fixed results for the synthetic visits, not found otherwise', async () => {
    expect((await claimApi.evaluate(NR)).status).toBe('complete');
    expect((await claimApi.evaluate('2026/11/03/000088')).status).toBe('not_applicable');
    await expect(claimApi.evaluate('2099/01/01/000001')).rejects.toBeInstanceOf(NotFoundError);
  });

  it('names what went wrong; anything unexpected is "unavailable", never a result', () => {
    expect(claimErrorKind(new ApiError(403, 'reference_forbidden'))).toBe('forbidden');
    expect(claimErrorKind(new ApiError(404, 'reference_not_found'))).toBe('notFound');
    expect(claimErrorKind(new ApiError(429, 'too_many_requests'))).toBe('busy');
    expect(claimErrorKind(new ApiError(502, 'BAD_SHAPE'))).toBe('badShape');
    expect(claimErrorKind(new ApiError(0, 'NETWORK'))).toBe('unavailable');
    expect(claimErrorKind(new Error('x'))).toBe('unavailable');
  });
});

describe('finding view', () => {
  const base = answer().findings.find((f) => f.rule_id === 'primary_diagnosis_coded')!;

  it('maps results to text and tone; a failed error is danger, a failed warning is warning', () => {
    expect(viewFinding(t, base)).toMatchObject({
      state: 'emr.claim.state.passed',
      pill: 'success',
    });
    expect(viewFinding(t, { ...base, result: 'failed', reason: 'missing' })).toMatchObject({
      state: 'emr.claim.state.missing',
      pill: 'danger',
    });
    expect(
      viewFinding(t, { ...base, result: 'failed', severity: 'warning', reason: 'mismatch' }),
    ).toMatchObject({ state: 'emr.claim.state.mismatch', pill: 'warning' });
    expect(
      viewFinding(t, { ...base, result: 'not_evaluated', reason: 'care_setting_unknown' }),
    ).toMatchObject({
      state: 'emr.claim.state.notEvaluated',
      note: 'emr.claim.reason.care_setting_unknown',
    });
  });

  it('an unknown rule is never shown as passed', () => {
    expect(viewFinding(t, { ...base, rule_id: 'new_rule' })).toEqual({
      label: 'emr.claim.rule.unknown',
      state: 'emr.claim.state.unknown',
      pill: 'neutral',
    });
  });
});

describe('live adapter', () => {
  it('sends only the rule set and the selected visit, in the body (never the URL)', async () => {
    const fetch = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(JSON.stringify(answer()), { status: 200 }));
    const result = await liveClaimApi.evaluate(NR);
    const [url, init] = fetch.mock.calls[0]!;
    expect(url).toBe('/api/v1/assistant/rules/evaluate');
    expect(init?.method).toBe('POST');
    expect(JSON.parse(String(init?.body))).toEqual({
      rule_set: { id: 'claim-readiness' },
      context: { references: [{ resource_type: 'encounter', resource_id: NR }] },
    });
    expect(result.evaluation_id).toBe(answer().evaluation_id);
  });

  it('a server refusal stays an error with its status', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ error: { code: 'reference_forbidden', message: 'x' } }), {
        status: 403,
      }),
    );
    await expect(liveClaimApi.evaluate(NR)).rejects.toMatchObject({
      status: 403,
      code: 'reference_forbidden',
    });
  });
});
