import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/api/liveApi';
import { commentOf, feedbackApi, feedbackErrorKind, liveFeedbackApi } from './feedbackApi';

afterEach(() => vi.restoreAllMocks());

const EVAL = '0b6f1c1e-3d2a-4d8e-9a51-5c0f7f1b2a90';

function answer(status: number, body: unknown) {
  return vi
    .spyOn(globalThis, 'fetch')
    .mockResolvedValue(new Response(JSON.stringify(body), { status }));
}

describe('feedback client', () => {
  it('sends a finding as the contract body and reports it stored', async () => {
    const fetch = answer(201, { feedback_id: 'f-1', version: 1 });
    const out = await liveFeedbackApi.submit({
      evaluation_id: EVAL,
      rule_id: 'discharge_summary_present',
      result: 'failed',
      reason: 'data_outdated',
      comment: 'Ditambahkan kemudian.',
    });
    expect(out).toEqual({ kind: 'sent', version: 1 });
    const [url, init] = fetch.mock.calls[0]!;
    expect(url).toBe('/api/v1/assistant/feedback');
    expect(init?.method).toBe('POST');
    expect(init?.credentials).toBe('same-origin');
    expect(JSON.parse(init?.body as string)).toEqual({
      evaluation_id: EVAL,
      rule_id: 'discharge_summary_present',
      result: 'failed',
      reason: 'data_outdated',
      comment: 'Ditambahkan kemudian.',
    });
  });

  it('an unchanged repeat (200) is stored too; an answer in another shape is an error', async () => {
    answer(200, { feedback_id: 'f-1', version: 2 });
    await expect(
      liveFeedbackApi.submit({ evaluation_id: EVAL, helpfulness: 'helpful' }),
    ).resolves.toEqual({ kind: 'sent', version: 2 });
    answer(201, { ok: true });
    await expect(
      liveFeedbackApi.submit({ evaluation_id: EVAL, helpfulness: 'helpful' }),
    ).rejects.toMatchObject({ code: 'BAD_SHAPE' });
  });

  it('demo data sends nothing and says so', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch');
    await expect(
      feedbackApi.submit({ evaluation_id: EVAL, helpfulness: 'helpful' }),
    ).resolves.toEqual({
      kind: 'demo',
    });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('names what went wrong; nothing was stored in any case', () => {
    expect(feedbackErrorKind(new ApiError(404, 'evaluation_not_found'))).toBe('notFound');
    expect(feedbackErrorKind(new ApiError(422, 'rule_not_in_evaluation'))).toBe('mismatch');
    expect(feedbackErrorKind(new ApiError(429, 'too_many_requests'))).toBe('busy');
    expect(feedbackErrorKind(new ApiError(403, 'forbidden'))).toBe('forbidden');
    expect(feedbackErrorKind(new ApiError(0, 'NETWORK'))).toBe('unavailable');
    expect(feedbackErrorKind(new Error('x'))).toBe('unavailable');
  });

  it('a comment is trimmed, and an empty one is none', () => {
    expect(commentOf('  a  ')).toBe('a');
    expect(commentOf('   ')).toBeUndefined();
  });
});
