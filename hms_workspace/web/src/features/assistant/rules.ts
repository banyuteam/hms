import type { EncounterJourney } from '@/api/journey';
import { facts, labs, prescriptions } from '@/api/select';
import type { ClaimErrorKind, ClaimEvaluation } from '@/api/claimApi';

/**
 * Rule-based assistant (deterministic, no language model; ADR-SVC-006). Topic detection and read-back run here: it reads
 * back what the tagged records contain and refuses clinical advice. Claim readiness is the exception: it is a domain rule,
 * evaluated by hms_services (`evaluate` in the reply), and only presented here. Replies are i18n message ids (+ values)
 * so they follow the UI locale; record text is passed through as stored (`raw`).
 */
export type TagKind = AssistantTag['kind'];

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
  | { claim: ClaimEvaluation };

export interface Reply {
  intent: Intent;
  lines: ReplyLine[];
  /** Claim readiness: the visit to have hms_services evaluate; the answer lines come from `claimLines`. */
  evaluate?: string;
}

/** What the assistant can be asked about a visit, in the order the quick-action buttons show them. */
export const TOPICS = [
  'claim',
  'summary',
  'diagnoses',
  'procedures',
  'labs',
  'medications',
] as const;
export type Topic = (typeof TOPICS)[number];

export type Intent =
  | Topic
  | 'refuse'
  | 'needTag'
  | 'needVisit'
  | 'chooseVisit'
  | 'notLoaded'
  | 'help';

/** The topic a tagged section stands for (F-8); sections without one (CPPT, radiology, billing) leave it to the text. */
const SECTION_TOPICS: Readonly<Record<string, Topic>> = {
  diagnoses: 'diagnoses',
  labs: 'labs',
  lab: 'labs',
  claim: 'claim',
  prescription: 'medications',
};

export function sectionTopic(tag: AssistantTag | undefined): Topic | undefined {
  return tag?.kind === 'section' && tag.section ? SECTION_TOPICS[tag.section] : undefined;
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

/** Requests for advice, diagnosis or treatment decisions (EN + ID). Checked before anything else. */
const ADVICE =
  /\b(should (i|we|he|she|the patient)|recommend|what (dose|drug|treatment)|which (drug|treatment|antibiotic)|diagnose|prognosis|is it safe|safe to|increase|decrease|stop the|start the|sarankan|rekomendasi|sebaiknya|harus (diberi|minum|dirawat)|dosis (yang|berapa)|obat apa|terapi apa|diagnosisnya apa|aman(kah)? untuk)\b/i;

const INTENTS: [Topic, RegExp][] = [
  ['claim', /\b(claim|klaim|bpjs|casemix|resume|ina-?cbg|readiness|kelengkapan)\b/i],
  ['diagnoses', /\b(diagnos\w*|icd-?10|dx)\b/i],
  ['procedures', /\b(procedure\w*|tindakan|icd-?9\w*|operasi|surgery)\b/i],
  ['labs', /\b(lab\w*|result\w*|hasil)\b/i],
  ['medications', /\b(med\w*|drug\w*|obat|resep|prescri\w*)\b/i],
  ['summary', /\b(summar\w*|ringkas\w*|overview|riwayat|timeline)\b/i],
];

export function detectIntent(text: string): Topic | 'refuse' | 'help' {
  if (ADVICE.test(text)) return 'refuse';
  return INTENTS.find(([, re]) => re.test(text))?.[0] ?? 'help';
}

type JourneyOf = (norawat: string) => EncounterJourney | undefined;

/**
 * Answers typed text. Advice is refused first. Text without a topic takes the topic of the tagged section it is asked
 * about, if that section has one (F-8); otherwise it gets the help text.
 */
export function reply(
  text: string,
  tags: readonly AssistantTag[],
  journeyOf: JourneyOf,
  chosen?: string,
): Reply {
  const intent = detectIntent(text);
  if (intent === 'refuse') return { intent, lines: [{ id: 'emr.ai.reply.refuse' }] };
  const subject = subjectOf(tags, chosen);
  const topic =
    intent === 'help' ? sectionTopic(subject.kind === 'visit' ? subject.tag : undefined) : intent;
  if (!topic) return { intent: 'help', lines: [{ id: 'emr.ai.reply.help' }] };
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

function answer(intent: Topic, subject: Subject, journeyOf: JourneyOf): Reply {
  // Only a tagged visit (encounter or section) names a visit; a patient tag never stands in for one.
  switch (subject.kind) {
    case 'patientOnly':
      return {
        intent: 'needVisit',
        lines: [{ id: 'emr.ai.reply.needVisit', values: { mrn: subject.mrn } }],
      };
    case 'ambiguous':
      return {
        intent: 'chooseVisit',
        lines: [{ id: 'emr.ai.reply.chooseVisit', values: { n: subject.visits } }],
      };
    case 'none':
      return { intent: 'needTag', lines: [{ id: 'emr.ai.reply.needTag' }] };
  }
  const norawat = subject.tag.norawat;
  // The server reads the visit itself; nothing needs to be loaded in the browser.
  if (intent === 'claim') return { intent, lines: [], evaluate: norawat };
  const j = journeyOf(norawat);
  if (!j)
    return { intent: 'notLoaded', lines: [{ id: 'emr.ai.reply.notLoaded', values: { norawat } }] };

  const lines: ReplyLine[] = [{ id: 'emr.ai.reply.source', values: { norawat } }];
  const f = facts(j);
  switch (intent) {
    case 'summary':
      lines.push({
        id: 'emr.ai.reply.summary',
        values: {
          setting: f.careSetting ?? '—',
          dpjp: f.dpjp ?? '—',
          los: f.lengthOfStay ?? '—',
          status: f.dischargeStatus ?? f.status ?? '—',
        },
      });
      for (const d of [...j.summary.diagnoses]
        .sort((a, b) => a.prioritas - b.prioritas)
        .slice(0, 3))
        lines.push({ raw: `${d.kd_penyakit} — ${d.diagnosis_name ?? ''}` });
      break;
    case 'diagnoses':
      if (j.summary.diagnoses.length === 0) lines.push({ id: 'emr.ai.reply.none' });
      for (const d of [...j.summary.diagnoses].sort((a, b) => a.prioritas - b.prioritas))
        lines.push({ raw: `${d.prioritas}. ${d.kd_penyakit} — ${d.diagnosis_name ?? ''}` });
      break;
    case 'procedures':
      if (j.summary.coded_procedures.length === 0) lines.push({ id: 'emr.ai.reply.none' });
      for (const p of j.summary.coded_procedures)
        lines.push({ raw: `ICD-9-CM ${p.kode} — ${p.procedure_name ?? ''}` });
      break;
    case 'labs': {
      const flagged = labs(j).flatMap((l) =>
        l.results.filter((r) => r.keterangan.trim() !== '').map((r) => ({ l, r })),
      );
      lines.push({ id: 'emr.ai.reply.labsFlagged', values: { n: flagged.length } });
      for (const { r } of flagged)
        lines.push({
          raw: `${r.item_name ?? ''}: ${r.nilai} ${r.unit ?? ''} (${r.nilai_rujukan}) [${r.keterangan}]`,
        });
      break;
    }
    case 'medications':
      for (const p of prescriptions(j))
        for (const it of p.items) lines.push({ raw: `${it.drug_name ?? ''} — ${it.aturan_pakai}` });
      if (lines.length === 1) lines.push({ id: 'emr.ai.reply.none' });
      break;
  }
  lines.push({ id: 'emr.ai.reply.disclaimer' });
  return { intent, lines };
}

/**
 * The answer to a claim question from the server's evaluation: which visit, which rule set, then the structured result
 * (every finding, grouped; `ClaimResult`).
 */
export function claimLines(norawat: string, e: ClaimEvaluation): ReplyLine[] {
  const lines: ReplyLine[] = [
    { id: 'emr.ai.reply.source', values: { norawat } },
    { id: 'emr.ai.reply.claimRuleSet', values: { version: e.rule_set.version } },
  ];
  if (e.status === 'not_applicable') lines.push({ id: 'emr.claim.notApplicable' });
  else {
    lines.push({ claim: e });
    lines.push({ id: 'emr.claim.scope' });
  }
  lines.push({ id: 'emr.ai.reply.disclaimer' });
  return lines;
}

/** The answer when the evaluation failed: nothing was checked, and the reply says so. */
export function claimErrorLines(norawat: string, kind: ClaimErrorKind): ReplyLine[] {
  return [{ id: 'emr.ai.reply.source', values: { norawat } }, { id: `emr.claim.error.${kind}` }];
}
