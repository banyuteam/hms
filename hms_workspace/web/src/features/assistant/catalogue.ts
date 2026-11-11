import { z } from 'zod';
import raw from './catalogue.json';

/**
 * The assistant catalogue (`catalogue.json`): topics, their patterns, advice refusal, section topics, the replies of each
 * step and how each answer is put together. Validated here once, at startup: an invalid catalogue throws instead of
 * quietly answering wrongly. What the code can do is fixed below (topics it can answer, record sources and their
 * fields, visit facts); the catalogue can only use those, so it stays data — no expressions, no code.
 */

/** Topics the code knows how to answer. The catalogue must use each exactly once in detection and in the buttons. */
export const TOPIC_IDS = [
  'claim',
  'summary',
  'diagnoses',
  'procedures',
  'labs',
  'medications',
] as const;
export type Topic = (typeof TOPIC_IDS)[number];

/** Record sources an answer can list, and the fields each row offers to `format`. */
export const ROW_FIELDS = {
  /** `summary.diagnoses`, priority order. */
  diagnoses: ['priority', 'code', 'name'],
  /** `summary.coded_procedures`, as stored. */
  codedProcedures: ['code', 'name'],
  /** Lab result lines the lab flagged (`keterangan` not empty). */
  flaggedLabResults: ['item', 'value', 'unit', 'range', 'flag'],
  /** Items of every prescription. */
  prescriptionItems: ['drug', 'instructions'],
} as const;
export type RowSource = keyof typeof ROW_FIELDS;

/** Visit facts a header can show; `rowCount` is the number of rows of that answer. */
export const FACTS = [
  'careSetting',
  'dpjp',
  'lengthOfStay',
  'dischargeOrVisitStatus',
  'rowCount',
] as const;
export type Fact = (typeof FACTS)[number];

const replyId = z.string().regex(/^emr\.[\w.]+$/, 'a message id under emr.*');
const topic = z.enum(TOPIC_IDS);
const pattern = z.object({ pattern: z.string().min(1), flags: z.literal('i') });

const rows = z
  .object({
    source: z.enum(Object.keys(ROW_FIELDS) as [RowSource, ...RowSource[]]),
    limit: z.number().int().positive().optional(),
    format: z.string().min(1),
  })
  .superRefine((r, ctx) => {
    const allowed: readonly string[] = ROW_FIELDS[r.source];
    for (const [, field] of r.format.matchAll(/\{(\w+)\}/g))
      if (!allowed.includes(field!))
        ctx.addIssue({
          code: 'custom',
          message: `{${field}} is not a field of ${r.source} (${allowed.join(', ')})`,
        });
  });

const answer = z.object({
  header: z
    .object({ reply: replyId, values: z.record(z.string(), z.enum(FACTS)).default({}) })
    .optional(),
  rows,
  whenEmpty: replyId.optional(),
});

const step = <I extends string>(intent: I) =>
  z.object({ intent: z.literal(intent), reply: replyId });

const schema = z
  .object({
    version: z.string().min(1),
    advice: pattern.extend({ reply: replyId }),
    help: z.object({ reply: replyId }),
    quickActions: z.object({ order: z.array(topic) }),
    intents: z.object({ topics: z.array(pattern.extend({ id: topic })) }),
    sectionTopics: z.object({ map: z.record(z.string(), topic) }),
    subject: z.object({
      replies: z.object({
        patientOnly: step('needVisit'),
        ambiguous: step('chooseVisit'),
        none: step('needTag'),
      }),
    }),
    answers: z.object({
      source: replyId,
      disclaimer: replyId,
      notLoaded: step('notLoaded'),
      topics: z.object({
        summary: answer,
        diagnoses: answer,
        procedures: answer,
        labs: answer,
        medications: answer,
      }),
    }),
    knowledge: z.object({
      dataset: z.string().min(1),
      refuseTags: z.array(z.string().min(1)),
    }),
    claim: z.object({
      ruleSet: replyId,
      notApplicable: replyId,
      scope: replyId,
      errorPrefix: z.string().regex(/^emr\.[\w.]+\.$/),
    }),
  })
  .superRefine((c, ctx) => {
    const once = (list: readonly string[], where: string) => {
      const missing = TOPIC_IDS.filter((t) => !list.includes(t));
      if (missing.length || list.length !== TOPIC_IDS.length)
        ctx.addIssue({
          code: 'custom',
          path: [where],
          message: `must list every topic exactly once (missing: ${missing.join(', ') || 'none'})`,
        });
    };
    once(c.quickActions.order, 'quickActions');
    once(
      c.intents.topics.map((i) => i.id),
      'intents',
    );
  });

export type Catalogue = z.infer<typeof schema>;
export type AnswerSpec = z.infer<typeof answer>;

function load(): Catalogue & {
  adviceRe: RegExp;
  intentRes: [Topic, RegExp][];
} {
  const parsed = schema.safeParse(raw);
  if (!parsed.success)
    throw new Error(
      `Assistant catalogue is invalid: ${parsed.error.issues
        .map((i) => `${i.path.join('.')}: ${i.message}`)
        .join('; ')}`,
    );
  const c = parsed.data;
  return {
    ...c,
    adviceRe: new RegExp(c.advice.pattern, c.advice.flags),
    intentRes: c.intents.topics.map((t) => [t.id, new RegExp(t.pattern, t.flags)]),
  };
}

/** The validated catalogue with its patterns compiled. */
export const CATALOGUE = load();

/** For tests: validates any object as a catalogue (the shipped one is validated at import). */
export function validateCatalogue(value: unknown) {
  return schema.safeParse(value);
}
