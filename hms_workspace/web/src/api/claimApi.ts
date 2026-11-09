import { z } from 'zod';
import { ApiError, liveSend } from '@/api/liveApi';
import { NotFoundError } from '@/api/patientApi';
import { SYNTHETIC_CLAIM_EVALUATIONS } from '@/data/claimFixtures';
import { useResource } from '@/lib/resource';

/**
 * Claim readiness, evaluated by hms_services (contract `hms_services/contracts/api/assistant-v1.openapi.yaml`, ADR-SVC-006).
 * The browser holds no copy of the rules: it sends the visit the person chose and shows the findings it gets back. The
 * answer is validated here; a shape the contract does not promise is an error, never trusted. The server authorizes
 * every request; the permission below only shapes the UI.
 */
export const CLAIM_PERMISSION = 'assistant.rules.evaluate';
export const CLAIM_RULE_SET = 'claim-readiness';

export const RESULTS = ['passed', 'failed', 'not_applicable', 'not_evaluated'] as const;

const finding = z.object({
  rule_id: z.string(),
  result: z.enum(RESULTS),
  severity: z.enum(['error', 'warning', 'info']),
  reason: z.string().nullable(),
  fields: z.array(z.string()),
  human_review: z.boolean(),
});

const evaluation = z.object({
  evaluation_id: z.string(),
  status: z.enum(['complete', 'partial', 'not_applicable']),
  evaluated_at: z.string(),
  rule_set: z.object({ id: z.string(), version: z.number().int() }),
  reference: z.object({ resource_type: z.literal('encounter'), resource_id: z.string() }),
  applicability: z.object({ applies: z.boolean(), reason: z.string().nullable() }),
  findings: z.array(finding),
  summary: z.object({
    passed: z.number().int(),
    failed_error: z.number().int(),
    failed_warning: z.number().int(),
    not_applicable: z.number().int(),
    not_evaluated: z.number().int(),
  }),
  data_completeness: z.object({
    complete: z.boolean(),
    sources_not_connected: z.array(z.string()),
    truncated: z.array(z.string()),
  }),
});

export type ClaimFinding = z.infer<typeof finding>;
export type ClaimEvaluation = z.infer<typeof evaluation>;

export interface ClaimApi {
  /** Runs the claim-readiness rule set on one visit (a new, audited evaluation on the server each time). */
  evaluate(norawat: string): Promise<ClaimEvaluation>;
}

/** Validates an answer; it must be about the visit that was asked for. */
export function parseEvaluation(body: unknown, norawat: string): ClaimEvaluation {
  const parsed = evaluation.safeParse(body);
  if (!parsed.success || parsed.data.reference.resource_id !== norawat)
    throw new ApiError(502, 'BAD_SHAPE');
  return parsed.data;
}

/** Exported for tests; the app uses `claimApi`. */
export const liveClaimApi: ClaimApi = {
  async evaluate(norawat) {
    const body = await liveSend('POST', '/assistant/rules/evaluate', {
      rule_set: { id: CLAIM_RULE_SET },
      context: { references: [{ resource_type: 'encounter', resource_id: norawat }] },
    });
    return parseEvaluation(body, norawat);
  },
};

/** Demo: fixed results for the synthetic visits (`src/data/claimFixtures.ts`), never computed in the browser. */
const syntheticClaimApi: ClaimApi = {
  evaluate: (norawat) =>
    new Promise((resolve, reject) =>
      setTimeout(() => {
        const e = SYNTHETIC_CLAIM_EVALUATIONS[norawat];
        if (e) resolve(structuredClone(e));
        else reject(new NotFoundError());
      }, 150),
    ),
};

// Written inline (not via isLiveApi()) so the bundler folds it and drops the unused adapter.
export const claimApi: ClaimApi =
  import.meta.env.VITE_DATA_SOURCE === 'bff' ? liveClaimApi : syntheticClaimApi;

/** Cache key (memory only, wiped on sign-out with every other entry). */
export const claimKey = (norawat: string) => ['assistant', 'claim', norawat] as const;

export function useClaimEvaluation(norawat: string | undefined, enabled: boolean) {
  const id = norawat ?? '';
  return useResource(claimKey(id), () => claimApi.evaluate(id), {
    enabled: enabled && Boolean(norawat),
  });
}

export type ClaimErrorKind = 'forbidden' | 'notFound' | 'busy' | 'badShape' | 'unavailable';

/** What went wrong, in the terms the UI explains. Nothing was checked in any of these cases. */
export function claimErrorKind(e: unknown): ClaimErrorKind {
  if (e instanceof NotFoundError) return 'notFound';
  if (!(e instanceof ApiError)) return 'unavailable';
  if (e.code === 'BAD_SHAPE') return 'badShape';
  if (e.status === 403) return 'forbidden';
  if (e.status === 404) return 'notFound';
  if (e.status === 429) return 'busy';
  return 'unavailable';
}
