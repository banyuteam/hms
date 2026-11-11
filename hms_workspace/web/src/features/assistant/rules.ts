import type { EncounterJourney } from '@/api/journey';
import { facts, labs, prescriptions, type EncounterFacts } from '@/api/select';
import type { ClaimErrorKind, ClaimEvaluation } from '@/api/claimApi';
import {
  CATALOGUE,
  type AnswerSpec,
  type Fact,
  type RowSource,
  type Topic,
  ROW_FIELDS,
} from './catalogue';
import type { Knowledge, KnowledgeMatch } from './knowledge';

/**
 * Rule-based assistant (deterministic, no language model; ADR-SVC-006). Topic detection and read-back run here: it reads
 * back what the tagged records contain and refuses clinical advice. Claim readiness is the exception: it is a domain rule,
 * evaluated by hms_services (`evaluate` in the reply), and only presented here. Replies are i18n message ids (+ values)
 * so they follow the UI locale; record text is passed through as stored (`raw`).
 *
 * What it recognises and how each answer is put together come from `catalogue.json` (validated in `catalogue.ts`):
 * topics and their patterns, advice refusal, section topics, the reply of every step and the rows/format of each answer.
 * This file holds what is code: choosing the visit, and reading the record sources the catalogue may name.
 */
export type TagKind = AssistantTag['kind'];
export type { Topic };

/**
 * A record the user tagged explicitly. A patient tag names the patient only: it never carries a visit, so the assistant
 * cannot answer about a visit the user did not choose (F-7; root CLAUDE.md §9, HMS-CRC rule 1). A visit is tagged as an
 * encounter, or as a section of one.
 */
export type AssistantTag =
  | { id: string; kind: 'patient'; mrn: string; norawat?: never; section?: never }
  | {
      id: string;
      kind: 'encounter' | 'section';
      norawat: string;
      mrn?: string;
      /** Section id within an encounter, e.g. `labs`, `cppt`, `diagnoses`. */
      section?: string;
    };

export type ReplyLine =
  | { id: string; values?: Record<string, string | number> }
  | { raw: string }
  /** The server's claim-readiness evaluation, shown as one structured result (`ClaimResult`). */
  | { claim: ClaimEvaluation }
  /** A general-help answer from the approved release, per language (shown in the UI locale). */
  | { text: Readonly<Record<string, string>> };

export interface Reply {
  intent: Intent;
  lines: ReplyLine[];
  /** Claim readiness: the visit to have hms_services evaluate; the answer lines come from `claimLines`. */
  evaluate?: string;
  /** General help: the release intent that answered. */
  knowledgeTag?: string;
}

/** What the assistant can be asked about a visit, in the order the quick-action buttons show them (catalogue). */
export const TOPICS: readonly Topic[] = CATALOGUE.quickActions.order;

export type Intent =
  | Topic
  | 'refuse'
  | 'needTag'
  | 'needVisit'
  | 'chooseVisit'
  | 'notLoaded'
  | 'help'
  /** General help from the approved release (how to use HMS). */
  | 'general';

/** The topic a tagged section stands for (F-8; catalogue `sectionTopics`); other sections leave it to the text. */
export function sectionTopic(tag: AssistantTag | undefined): Topic | undefined {
  return tag?.kind === 'section' && tag.section
    ? CATALOGUE.sectionTopics.map[tag.section]
    : undefined;
}

export type Subject =
  | { kind: 'visit'; tag: Extract<AssistantTag, { norawat: string }> }
  | { kind: 'patientOnly'; mrn: string }
  | { kind: 'ambiguous'; visits: number }
  | { kind: 'none' };

/**
 * The visit a question is about, never guessed (F-9; root CLAUDE.md §9). The visit tag the user chose, if it is still
 * tagged; otherwise the only tagged visit (several tags of one visit count once, the latest wins so its section applies).
 * With several different visits and no choice, the user has to choose.
 */
export function subjectOf(tags: readonly AssistantTag[], chosen?: string): Subject {
  const visits = tags.filter(
    (t): t is Extract<AssistantTag, { norawat: string }> => t.kind !== 'patient',
  );
  const picked = chosen ? visits.find((t) => t.id === chosen) : undefined;
  if (picked) return { kind: 'visit', tag: picked };
  const distinct = new Set(visits.map((t) => t.norawat)).size;
  if (distinct === 1) return { kind: 'visit', tag: visits[visits.length - 1]! };
  if (distinct > 1) return { kind: 'ambiguous', visits: distinct };
  const patient = [...tags].reverse().find((t) => t.kind === 'patient');
  return patient ? { kind: 'patientOnly', mrn: patient.mrn } : { kind: 'none' };
}

/** Advice is refused first (catalogue `advice`); then the first topic pattern that matches (catalogue `intents`). */
export function detectIntent(text: string): Topic | 'refuse' | 'help' {
  if (CATALOGUE.adviceRe.test(text)) return 'refuse';
  return CATALOGUE.intentRes.find(([, re]) => re.test(text))?.[0] ?? 'help';
}

type JourneyOf = (norawat: string) => EncounterJourney | undefined;

const refusal = (): Reply => ({ intent: 'refuse', lines: [{ id: CATALOGUE.advice.reply }] });

/** A general-help answer; a release intent listed in `knowledge.refuseTags` gets the one advice refusal. */
function fromKnowledge(m: KnowledgeMatch): Reply {
  if (CATALOGUE.knowledge.refuseTags.includes(m.tag)) return refusal();
  return { intent: 'general', knowledgeTag: m.tag, lines: [{ text: m.responses }] };
}

/**
 * Answers typed text, in the order of catalogue `knowledge.description` (owner, 2026-11-10): general help first (a
 * strong, then a weak match: its answers are approved static text, never advice); then advice refusal; the record
 * topics; the topic of the tagged section asked about (F-8); the help text. Without `knowledge` (none approved, not
 * loaded yet, or the synthetic build) the general-help step is skipped and advice refusal comes first.
 */
export function reply(
  text: string,
  tags: readonly AssistantTag[],
  journeyOf: JourneyOf,
  chosen?: string,
  knowledge?: Knowledge,
): Reply {
  const general = knowledge?.strong(text) ?? knowledge?.weak(text);
  if (general) return fromKnowledge(general);
  if (CATALOGUE.adviceRe.test(text)) return refusal();
  const subject = subjectOf(tags, chosen);
  const byText = CATALOGUE.intentRes.find(([, re]) => re.test(text))?.[0];
  if (byText) return answer(byText, subject, journeyOf);
  const topic = sectionTopic(subject.kind === 'visit' ? subject.tag : undefined);
  if (!topic) return { intent: 'help', lines: [{ id: CATALOGUE.help.reply }] };
  return answer(topic, subject, journeyOf);
}

/** Answers a quick-action topic (no text to interpret). */
export function ask(
  topic: Topic,
  tags: readonly AssistantTag[],
  journeyOf: JourneyOf,
  chosen?: string,
): Reply {
  return answer(topic, subjectOf(tags, chosen), journeyOf);
}

type Row = Record<string, string>;

/** The record sources an answer may list (catalogue `rows.source`), each row with the fields of `ROW_FIELDS`. */
const ROWS: {
  [S in RowSource]: (j: EncounterJourney) => Record<(typeof ROW_FIELDS)[S][number], string>[];
} = {
  diagnoses: (j) =>
    [...j.summary.diagnoses]
      .sort((a, b) => a.prioritas - b.prioritas)
      .map((d) => ({
        priority: `${d.prioritas}`,
        code: d.kd_penyakit,
        name: d.diagnosis_name ?? '',
      })),
  codedProcedures: (j) =>
    j.summary.coded_procedures.map((p) => ({ code: p.kode, name: p.procedure_name ?? '' })),
  flaggedLabResults: (j) =>
    labs(j).flatMap((l) =>
      l.results
        .filter((r) => r.keterangan.trim() !== '')
        .map((r) => ({
          item: r.item_name ?? '',
          value: r.nilai,
          unit: r.unit ?? '',
          range: r.nilai_rujukan,
          flag: r.keterangan,
        })),
    ),
  prescriptionItems: (j) =>
    prescriptions(j).flatMap((p) =>
      p.items.map((it) => ({ drug: it.drug_name ?? '', instructions: it.aturan_pakai })),
    ),
};

/** Visit facts a header may show (catalogue `header.values`); a fact not recorded shows as "—". */
const FACT: Record<Fact, (f: EncounterFacts, rowCount: number) => string | number> = {
  careSetting: (f) => f.careSetting ?? '—',
  dpjp: (f) => f.dpjp ?? '—',
  lengthOfStay: (f) => f.lengthOfStay ?? '—',
  dischargeOrVisitStatus: (f) => f.dischargeStatus ?? f.status ?? '—',
  rowCount: (_, n) => n,
};

const fill = (format: string, row: Row) =>
  format.replace(/\{(\w+)\}/g, (_, k: string) => row[k] ?? '');

/** One read-back answer as the catalogue describes it: source · header · rows (or "none") · disclaimer. */
function readBack(spec: AnswerSpec, j: EncounterJourney, norawat: string): ReplyLine[] {
  const lines: ReplyLine[] = [{ id: CATALOGUE.answers.source, values: { norawat } }];
  const all: Row[] = ROWS[spec.rows.source](j);
  if (spec.header) {
    const f = facts(j);
    lines.push({
      id: spec.header.reply,
      values: Object.fromEntries(
        Object.entries(spec.header.values).map(([k, fact]) => [k, FACT[fact](f, all.length)]),
      ),
    });
  }
  const rows = spec.rows.limit ? all.slice(0, spec.rows.limit) : all;
  if (rows.length === 0 && spec.whenEmpty) lines.push({ id: spec.whenEmpty });
  for (const row of rows) lines.push({ raw: fill(spec.rows.format, row) });
  lines.push({ id: CATALOGUE.answers.disclaimer });
  return lines;
}

function answer(intent: Topic, subject: Subject, journeyOf: JourneyOf): Reply {
  // Only a tagged visit (encounter or section) names a visit; a patient tag never stands in for one.
  const steps = CATALOGUE.subject.replies;
  switch (subject.kind) {
    case 'patientOnly':
      return {
        intent: steps.patientOnly.intent,
        lines: [{ id: steps.patientOnly.reply, values: { mrn: subject.mrn } }],
      };
    case 'ambiguous':
      return {
        intent: steps.ambiguous.intent,
        lines: [{ id: steps.ambiguous.reply, values: { n: subject.visits } }],
      };
    case 'none':
      return { intent: steps.none.intent, lines: [{ id: steps.none.reply }] };
  }
  const norawat = subject.tag.norawat;
  // The server reads the visit itself; nothing needs to be loaded in the browser.
  if (intent === 'claim') return { intent, lines: [], evaluate: norawat };
  const j = journeyOf(norawat);
  if (!j) {
    const notLoaded = CATALOGUE.answers.notLoaded;
    return { intent: notLoaded.intent, lines: [{ id: notLoaded.reply, values: { norawat } }] };
  }
  return { intent, lines: readBack(CATALOGUE.answers.topics[intent], j, norawat) };
}

/**
 * The answer to a claim question from the server's evaluation: which visit, which rule set, then the structured result
 * (every finding, grouped; `ClaimResult`).
 */
export function claimLines(norawat: string, e: ClaimEvaluation): ReplyLine[] {
  const c = CATALOGUE.claim;
  const lines: ReplyLine[] = [
    { id: CATALOGUE.answers.source, values: { norawat } },
    { id: c.ruleSet, values: { version: e.rule_set.version } },
  ];
  if (e.status === 'not_applicable') lines.push({ id: c.notApplicable });
  else {
    lines.push({ claim: e });
    lines.push({ id: c.scope });
  }
  lines.push({ id: CATALOGUE.answers.disclaimer });
  return lines;
}

/** The answer when the evaluation failed: nothing was checked, and the reply says so. */
export function claimErrorLines(norawat: string, kind: ClaimErrorKind): ReplyLine[] {
  return [
    { id: CATALOGUE.answers.source, values: { norawat } },
    { id: `${CATALOGUE.claim.errorPrefix}${kind}` },
  ];
}
