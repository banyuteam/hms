import { z } from 'zod';
import type { ClaimFinding } from '@/api/claimApi';
import { ApiError, liveSend } from '@/api/liveApi';

/**
 * Feedback on a claim-readiness evaluation (contract `hms_services/contracts/api/assistant-v1.openapi.yaml` 1.1.0,
 * ADR-SVC-008). Feedback is evidence for rule owners: it never changes a result. The server accepts it only for an
 * evaluation the same person ran at the session facility in the last 7 days, and checks the rule and result against
 * its receipt. Demo data sends nothing.
 */
export const FINDING_REASONS = [
  'result_wrong',
  'unclear',
  'not_relevant',
  'data_outdated',
] as const;
export const HELPFULNESS = ['helpful', 'partially_helpful', 'not_helpful'] as const;
export const EXPECTED = [
  'more_specific',
  'different_interpretation',
  'actionable_steps',
  'additional_information',
  'other',
] as const;
/** Characters (not bytes), as the server counts them. */
export const COMMENT_MAX = 200;

export type FindingReason = (typeof FINDING_REASONS)[number];
export type Helpfulness = (typeof HELPFULNESS)[number];
export type Expected = (typeof EXPECTED)[number];

export type FeedbackBody =
  | {
      evaluation_id: string;
      rule_id: string;
      result: ClaimFinding['result'];
      reason: FindingReason;
      comment?: string;
    }
  | { evaluation_id: string; helpfulness: Helpfulness; expected?: Expected; comment?: string };

/** `sent`: stored by the server (or unchanged from the last time). `demo`: demo data, nothing was sent. */
export type FeedbackOutcome = { kind: 'sent'; version: number } | { kind: 'demo' };

const stored = z.object({ feedback_id: z.string(), version: z.number().int().min(1) });

export interface FeedbackApi {
  submit(body: FeedbackBody): Promise<FeedbackOutcome>;
}

/** Exported for tests; the app uses `feedbackApi`. */
export const liveFeedbackApi: FeedbackApi = {
  async submit(body) {
    const parsed = stored.safeParse(await liveSend('POST', '/assistant/feedback', body));
    if (!parsed.success) throw new ApiError(502, 'BAD_SHAPE');
    return { kind: 'sent', version: parsed.data.version };
  },
};

const demoFeedbackApi: FeedbackApi = { submit: () => Promise.resolve({ kind: 'demo' }) };

// Written inline (not via isLiveApi()) so the bundler folds it and drops the unused adapter.
export const feedbackApi: FeedbackApi =
  import.meta.env.VITE_DATA_SOURCE === 'bff' ? liveFeedbackApi : demoFeedbackApi;

/** A comment as sent: trimmed; empty means none. */
export function commentOf(text: string): string | undefined {
  const c = text.trim();
  return c === '' ? undefined : c;
}

export type FeedbackErrorKind = 'notFound' | 'mismatch' | 'busy' | 'forbidden' | 'unavailable';

/** What went wrong, in the terms the UI explains. Nothing was stored in any of these cases. */
export function feedbackErrorKind(e: unknown): FeedbackErrorKind {
  if (!(e instanceof ApiError)) return 'unavailable';
  if (e.status === 404) return 'notFound';
  if (e.status === 422) return 'mismatch';
  if (e.status === 429) return 'busy';
  if (e.status === 403) return 'forbidden';
  return 'unavailable';
}
