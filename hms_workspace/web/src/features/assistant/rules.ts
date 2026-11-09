import type { EncounterJourney } from '@/api/journey';
import { facts, labs, prescriptions } from '@/api/select';
import type { ClaimErrorKind, ClaimEvaluation, ClaimFinding } from '@/api/claimApi';

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
  | { finding: ClaimFinding };

export interface Reply {
  intent: Intent;
  lines: ReplyLine[];
  /** Claim readiness: the visit to have hms_services evaluate; the answer lines come from `claimLines`. */
  evaluate?: string;
}

export type Intent =
  | 'refuse'
  | 'needTag'
  | 'needVisit'
  | 'notLoaded'
  | 'summary'
  | 'diagnoses'
  | 'procedures'
  | 'labs'
  | 'medications'
  | 'claim'
  | 'help';

/** Requests for advice, diagnosis or treatment decisions (EN + ID). Checked before anything else. */
const ADVICE =
  /\b(should (i|we|he|she|the patient)|recommend|what (dose|drug|treatment)|which (drug|treatment|antibiotic)|diagnose|prognosis|is it safe|safe to|increase|decrease|stop the|start the|sarankan|rekomendasi|sebaiknya|harus (diberi|minum|dirawat)|dosis (yang|berapa)|obat apa|terapi apa|diagnosisnya apa|aman(kah)? untuk)\b/i;

const INTENTS: [
  Exclude<Intent, 'refuse' | 'needTag' | 'needVisit' | 'notLoaded' | 'help'>,
  RegExp,
][] = [
  ['claim', /\b(claim|klaim|bpjs|casemix|resume|ina-?cbg|readiness|kelengkapan)\b/i],
  ['diagnoses', /\b(diagnos\w*|icd-?10|dx)\b/i],
  ['procedures', /\b(procedure\w*|tindakan|icd-?9\w*|operasi|surgery)\b/i],
  ['labs', /\b(lab\w*|result\w*|hasil)\b/i],
  ['medications', /\b(med\w*|drug\w*|obat|resep|prescri\w*)\b/i],
  ['summary', /\b(summar\w*|ringkas\w*|overview|riwayat|timeline)\b/i],
];

export function detectIntent(text: string): Intent {
  if (ADVICE.test(text)) return 'refuse';
  return INTENTS.find(([, re]) => re.test(text))?.[0] ?? 'help';
}

export function reply(
  text: string,
  tags: readonly AssistantTag[],
  journeyOf: (norawat: string) => EncounterJourney | undefined,
): Reply {
  const intent = detectIntent(text);
  if (intent === 'refuse') return { intent, lines: [{ id: 'emr.ai.reply.refuse' }] };
  if (intent === 'help') return { intent, lines: [{ id: 'emr.ai.reply.help' }] };

  // Only a tagged visit (encounter or section) names a visit; a patient tag never stands in for one.
  const norawat = [...tags].reverse().find((t) => t.kind !== 'patient')?.norawat;
  if (!norawat) {
    const patient = [...tags].reverse().find((t) => t.kind === 'patient');
    return patient
      ? {
          intent: 'needVisit',
          lines: [{ id: 'emr.ai.reply.needVisit', values: { mrn: patient.mrn } }],
        }
      : { intent: 'needTag', lines: [{ id: 'emr.ai.reply.needTag' }] };
  }
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

/** The answer to a claim question from the server's evaluation: which visit, which rule set, then every finding. */
export function claimLines(norawat: string, e: ClaimEvaluation): ReplyLine[] {
  const lines: ReplyLine[] = [
    { id: 'emr.ai.reply.source', values: { norawat } },
    { id: 'emr.ai.reply.claimRuleSet', values: { version: e.rule_set.version } },
  ];
  if (e.status === 'not_applicable') lines.push({ id: 'emr.claim.notApplicable' });
  else {
    for (const finding of e.findings) lines.push({ finding });
    if (e.status === 'partial') lines.push({ id: 'emr.claim.partial' });
    lines.push({ id: 'emr.claim.scope' });
  }
  lines.push({ id: 'emr.ai.reply.disclaimer' });
  return lines;
}

/** The answer when the evaluation failed: nothing was checked, and the reply says so. */
export function claimErrorLines(norawat: string, kind: ClaimErrorKind): ReplyLine[] {
  return [{ id: 'emr.ai.reply.source', values: { norawat } }, { id: `emr.claim.error.${kind}` }];
}
