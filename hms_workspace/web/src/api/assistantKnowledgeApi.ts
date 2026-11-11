import { z } from 'zod';
import { ApiError, isLiveApi, liveGet } from '@/api/liveApi';
import { useResource } from '@/lib/resource';

/**
 * The approved general-help release (assistant-v1 1.1.0, `GET /assistant/knowledge/general-help`): how to use HMS, no
 * patient data. hms_services serves it only once the dataset is approved, and leaves out intents still waiting for facts.
 * Live only: the synthetic build has no server, so it has no general help (the assistant answers as before).
 */
const releaseSchema = z.object({
  dataset: z.string(),
  version: z.string(),
  approved_at: z.string(),
  languages: z.array(z.string()).min(1),
  intents: z.array(
    z.object({
      tag: z.string().min(1),
      patterns: z.array(z.string()).min(1),
      responses: z.record(z.string(), z.string()),
    }),
  ),
});
export type KnowledgeRelease = z.infer<typeof releaseSchema>;

export const knowledgeKey = ['assistant', 'knowledge', 'general-help'] as const;

export async function fetchGeneralHelp(): Promise<KnowledgeRelease> {
  const parsed = releaseSchema.safeParse(await liveGet('/assistant/knowledge/general-help'));
  if (!parsed.success) throw new ApiError(502, 'BAD_SHAPE');
  return parsed.data;
}

/** Loads the release once per session into the data cache (cleared on sign-out); nothing in the synthetic build. */
export function useGeneralHelp() {
  return useResource(knowledgeKey, fetchGeneralHelp, { enabled: isLiveApi() });
}
