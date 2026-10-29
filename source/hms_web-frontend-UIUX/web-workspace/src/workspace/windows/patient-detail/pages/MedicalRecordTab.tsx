import { Fragment, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useIntl, type IntlShape } from 'react-intl';
import { ToggleButton, ToggleButtonGroup } from 'react-aria-components';
import { usePatientMedicalRecord } from '@/api/usePatient';
import type {
  Allergy,
  ClinicalNote,
  MrAssessment,
  MrDiagnosis,
  MrEncounter,
  PatientRecord,
} from '@/api/types';
import { emitAudit } from '@/audit/audit';
import { Button } from '@/components/Button';
import { Card } from '@/components/Card';
import { FieldList, FieldRow } from '@/components/FieldRow';
import { Icon } from '@/components/Icon';
import { StatusPill } from '@/components/StatusPill';
import { formatDate, formatDateTime, formatShortDateTime } from '@/i18n/format';
import { useLocaleStore } from '@/i18n/localeStore';
import type { Locale } from '@/i18n/locales';
import { enumLabel } from '../labels';
import type { TabId } from '../sections';
import styles from './MedicalRecordTab.module.css';
import pageStyles from './pages.module.css';

type Scope = 'current' | 'all';

/** How many encounters show their supporting findings before "N older encounters" (mockup 16). */
const SUPPORT_GROUPS = 2;
const DASH = '—';

/**
 * Figma "14 Medical Record tab" (current encounter) and "16" (all encounters), `patient-medical-record-fields.md` §1–§2a:
 * a read-only summary of seven cards — final diagnoses, medical history (+ supporting findings), clinical notes (allergy pinned),
 * procedures & interventions, treatment and outcomes, discharge plan / follow-up, digital signature and date.
 * Open to every role for now (OQ-55); opening the tab emits an audit event. Clinical free text is shown as stored (OQ-34).
 */
export function MedicalRecordTab({
  patient,
  onOpenTab,
}: {
  patient: PatientRecord;
  onOpenTab?: (id: TabId) => void;
}) {
  const intl = useIntl();
  const locale = useLocaleStore((s) => s.locale);
  const { data, isPending, error, refetch } = usePatientMedicalRecord(patient.mrn);
  const [scope, setScope] = useState<Scope>('current');
  const [query, setQuery] = useState('');

  useEffect(() => {
    emitAudit('record.open', 'medical-record');
  }, []);

  const q = query.trim().toLowerCase();
  const currentNo = patient.currentEncounter.no;

  // Scope first, then search: the search only narrows diagnoses, notes and procedures (the lists that carry free text).
  const encounters = useMemo(() => {
    const scoped = (data?.encounters ?? []).filter((e) => scope === 'all' || e.no === currentNo);
    if (!q) return scoped;
    const has = (...parts: Array<string | null | undefined>) =>
      parts.some((p) => (p ?? '').toLowerCase().includes(q));
    return scoped.map((e) => ({
      ...e,
      diagnoses: e.diagnoses.filter((d) => has(d.code, d.name)),
      notes: e.notes.filter((n) =>
        has(n.author, n.text, n.soap ? Object.values(n.soap).join(' ') : null),
      ),
      procedures: e.procedures.filter((p) => has(p.name, p.by, p.icd9)),
    }));
  }, [data, scope, q, currentNo]);

  if (isPending) {
    return (
      <div className={pageStyles.page} role="status" aria-live="polite">
        <p className={pageStyles.empty}>{intl.formatMessage({ id: 'mr.loading' })}</p>
      </div>
    );
  }
  if (error) {
    return (
      <div className={pageStyles.page} role="alert">
        <p>{intl.formatMessage({ id: 'mr.error' })}</p>
        <div>
          <Button onPress={() => void refetch()}>
            {intl.formatMessage({ id: 'detail.retry' })}
          </Button>
        </div>
      </div>
    );
  }

  const all = data.encounters;
  const first = all.at(-1);
  const last = all[0];
  const context =
    scope === 'current'
      ? intl.formatMessage(
          { id: 'mr.context' },
          {
            no: patient.currentEncounter.no,
            date: formatDate(new Date(patient.currentEncounter.admittedAt), locale),
          },
        )
      : first && last
        ? intl.formatMessage(
            { id: 'mr.context.all' },
            {
              count: all.length,
              from: formatMonthYear(new Date(first.registeredAt), locale),
              to: formatMonthYear(new Date(last.registeredAt), locale),
            },
          )
        : '';

  return (
    <div className={pageStyles.page}>
      <div className={pageStyles.toolbar}>
        <ToggleButtonGroup
          className={pageStyles.scope}
          aria-label={intl.formatMessage({ id: 'mr.scope.label' })}
          selectionMode="single"
          disallowEmptySelection
          selectedKeys={[scope]}
          onSelectionChange={(k) => setScope(([...k][0] as Scope) ?? 'current')}
        >
          {(['current', 'all'] as const).map((s) => (
            <ToggleButton key={s} id={s} className={pageStyles.scopeButton}>
              {intl.formatMessage({ id: `mr.scope.${s}` })}
            </ToggleButton>
          ))}
        </ToggleButtonGroup>
        <span className={pageStyles.muted}>{context}</span>
        <span className={pageStyles.spacer} />
        <label className={pageStyles.search}>
          <Icon name="search" size={16} />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label={intl.formatMessage({ id: 'mr.search.label' })}
            placeholder={intl.formatMessage({ id: 'mr.search.placeholder' })}
          />
        </label>
      </div>

      <DiagnosesCard encounters={encounters} scope={scope} />
      <HistoryCard encounters={encounters} scope={scope} onOpenTab={onOpenTab} />
      <NotesCard encounters={encounters} scope={scope} allergies={data.allergies} />
      <ProceduresCard encounters={encounters} scope={scope} />
      <OutcomesCard encounters={encounters} scope={scope} />
      <FollowUpCard encounters={encounters} scope={scope} />
      <SignatureCard encounters={encounters} scope={scope} />
    </div>
  );
}

interface SectionProps {
  encounters: MrEncounter[];
  scope: Scope;
}

function formatMonthYear(date: Date, locale: Locale): string {
  return formatDate(date, locale).replace(/^\d+\s/, '');
}

/** `26 Oct 2026 · Inpatient` — how a row says which encounter it belongs to. */
function encounterLabel(intl: IntlShape, locale: Locale, e: MrEncounter): string {
  return `${formatDate(new Date(e.registeredAt), locale)} · ${enumLabel(intl, 'care', e.care)}`;
}

/** Group header: date · type · unit. */
function GroupHeader({ e }: { e: MrEncounter }) {
  const intl = useIntl();
  const locale = useLocaleStore((s) => s.locale);
  return (
    <h4 className={styles.group}>
      {intl.formatMessage(
        { id: 'mr.group' },
        {
          date: formatDate(new Date(e.registeredAt), locale),
          care: enumLabel(intl, 'care', e.care),
          unit: e.unit,
        },
      )}
    </h4>
  );
}

/** Sections 5–7 of an encounter that is still open. */
function NotDischarged() {
  const intl = useIntl();
  return <p className={pageStyles.empty}>{intl.formatMessage({ id: 'mr.status.open' })}</p>;
}

// 1 ─ Final diagnoses ────────────────────────────────────────────────────────────────────────────────────────────────

function DiagnosesCard({ encounters, scope }: SectionProps) {
  const intl = useIntl();
  const locale = useLocaleStore((s) => s.locale);
  const rows: Array<{ e: MrEncounter; d: MrDiagnosis }> = encounters.flatMap((e) =>
    [...e.diagnoses].sort((a, b) => a.priority - b.priority).map((d) => ({ e, d })),
  );
  const admission = scope === 'current' ? encounters[0]?.admissionDiagnosis : null;

  return (
    <Card title={intl.formatMessage({ id: 'mr.card.diagnoses' })} icon="clipboard">
      {admission && (
        <p className={pageStyles.muted}>
          {intl.formatMessage({ id: 'mr.dx.admission' }, { dx: admission })}
        </p>
      )}
      {rows.length === 0 ? (
        <p className={pageStyles.empty}>{intl.formatMessage({ id: 'mr.dx.empty' })}</p>
      ) : (
        <table className={styles.table}>
          <thead>
            <tr>
              <th scope="col">{intl.formatMessage({ id: 'mr.dx.col.code' })}</th>
              <th scope="col">{intl.formatMessage({ id: 'mr.dx.col.diagnosis' })}</th>
              <th scope="col">{intl.formatMessage({ id: 'mr.dx.col.role' })}</th>
              <th scope="col">{intl.formatMessage({ id: 'mr.dx.col.condition' })}</th>
              <th scope="col">
                {intl.formatMessage({
                  id: scope === 'all' ? 'mr.dx.col.encounter' : 'mr.dx.col.type',
                })}
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ e, d }) => (
              <tr key={`${e.no}-${d.code}`}>
                <td className={styles.code}>{d.code}</td>
                <td>{d.name}</td>
                <td>
                  <StatusPill status={d.priority === 1 ? 'info' : 'neutral'}>
                    {intl.formatMessage({ id: d.priority === 1 ? 'dx.primary' : 'dx.secondary' })}
                  </StatusPill>
                </td>
                <td>{intl.formatMessage({ id: `dx.${d.isNew ? 'new' : 'existing'}` })}</td>
                <td>
                  {scope === 'all'
                    ? encounterLabel(intl, locale, e)
                    : enumLabel(intl, 'care', e.care)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <span className={pageStyles.muted}>
        {intl.formatMessage({ id: scope === 'all' ? 'mr.dx.codesAll' : 'mr.dx.codes' })}
      </span>
    </Card>
  );
}

// 2 ─ Medical history + supporting findings ─────────────────────────────────────────────────────────────────────────

function AssessmentBlocks({ a }: { a: MrAssessment }) {
  const intl = useIntl();
  const locale = useLocaleStore((s) => s.locale);
  const blocks: Array<[string, string]> = [
    ['field.chiefComplaint', a.chiefComplaint],
    ['field.presentIllness', a.presentIllness],
    ['field.pastIllness', a.pastIllness],
    ['field.familyHistory', a.familyHistory],
    ['field.medicationHistory', a.medicationHistory],
  ];
  return (
    <>
      {blocks.map(([key, value]) => (
        <div key={key} className={pageStyles.block}>
          <span className={pageStyles.blockLabel}>{intl.formatMessage({ id: key })}</span>
          <span>{value}</span>
        </div>
      ))}
      <span className={pageStyles.muted}>
        {intl.formatMessage(
          { id: a.kind === 'admission' ? 'mr.history.source' : 'mr.history.sourceOutpatient' },
          { at: formatDateTime(new Date(a.assessedAt), locale) },
        )}
      </span>
    </>
  );
}

function SupportLinks({
  target,
  label,
  onOpenTab,
}: {
  target: TabId;
  label: string;
  onOpenTab?: (id: TabId) => void;
}) {
  if (!onOpenTab) return null;
  return (
    <button type="button" className={styles.link} onClick={() => onOpenTab(target)}>
      {label}
    </button>
  );
}

/** Laboratory · Radiology · Medication therapy of one encounter, the five newest each (Figma "Supporting findings"). */
function Findings({
  e,
  onOpenTab,
  showExam,
}: {
  e: MrEncounter;
  onOpenTab?: (id: TabId) => void;
  showExam: boolean;
}) {
  const intl = useIntl();
  const locale = useLocaleStore((s) => s.locale);
  const at = (iso: string) => formatShortDateTime(new Date(iso), locale);
  const newest = <T extends { at?: string; orderedAt?: string }>(list: T[]) =>
    [...list]
      .sort((a, b) => (b.at ?? b.orderedAt ?? '').localeCompare(a.at ?? a.orderedAt ?? ''))
      .slice(0, 5);

  return (
    <div className={styles.findings}>
      {showExam && (
        <div className={pageStyles.block}>
          <span className={pageStyles.blockLabel}>
            {intl.formatMessage({ id: 'mr.support.exam' })}
          </span>
          <span>{e.physicalExam ?? DASH}</span>
        </div>
      )}

      <div className={styles.findingGroup}>
        <div className={styles.findingHead}>
          <h5 className={styles.findingTitle}>{intl.formatMessage({ id: 'mr.support.lab' })}</h5>
          <SupportLinks
            target="results"
            label={intl.formatMessage({ id: 'mr.support.viewResults' })}
            onOpenTab={onOpenTab}
          />
        </div>
        {e.labs.length === 0 ? (
          <p className={pageStyles.empty}>{intl.formatMessage({ id: 'mr.support.labEmpty' })}</p>
        ) : (
          <ul className={styles.results}>
            {newest(e.labs).map((l) => (
              <li key={l.id} className={styles.result}>
                <span className={styles.resultHead}>
                  <strong>{l.name}</strong>
                  <span className={pageStyles.muted}>{at(l.at)}</span>
                </span>
                {l.values && <span>{l.values}</span>}
                {l.note && (
                  <span className={pageStyles.muted}>
                    {intl.formatMessage({ id: 'mr.support.note' }, { note: l.note })}
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className={styles.findingGroup}>
        <div className={styles.findingHead}>
          <h5 className={styles.findingTitle}>
            {intl.formatMessage({ id: 'mr.support.radiology' })}
          </h5>
        </div>
        {e.radiology.length === 0 ? (
          <p className={pageStyles.empty}>
            {intl.formatMessage({ id: 'mr.support.radiologyEmpty' })}
          </p>
        ) : (
          <ul className={styles.results}>
            {newest(e.radiology).map((r) => (
              <li key={r.id} className={styles.result}>
                <span className={styles.resultHead}>
                  <strong>{r.name}</strong>
                  <span className={pageStyles.muted}>{at(r.at)}</span>
                </span>
                <span>{r.reading}</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className={styles.findingGroup}>
        <div className={styles.findingHead}>
          <h5 className={styles.findingTitle}>
            {intl.formatMessage({ id: 'mr.support.therapy' })}
          </h5>
          <SupportLinks
            target="medications"
            label={intl.formatMessage({ id: 'mr.support.viewMeds' })}
            onOpenTab={onOpenTab}
          />
        </div>
        {e.therapy.length === 0 ? (
          <p className={pageStyles.empty}>
            {intl.formatMessage({ id: 'mr.support.therapyEmpty' })}
          </p>
        ) : (
          <ul className={styles.results}>
            {newest(e.therapy).map((t) => (
              <li key={t.id} className={styles.result}>
                <span className={styles.resultHead}>
                  <strong>{t.name}</strong>
                  <span className={pageStyles.muted}>{t.period}</span>
                </span>
                <span className={pageStyles.muted}>
                  {intl.formatMessage(
                    { id: 'mr.support.ordered' },
                    { at: at(t.orderedAt), by: t.orderedBy },
                  )}
                  {t.dosesGiven !== null &&
                    ` · ${intl.formatMessage({ id: 'mr.support.doses' }, { count: t.dosesGiven })}`}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function HistoryCard({
  encounters,
  scope,
  onOpenTab,
}: SectionProps & { onOpenTab?: (id: TabId) => void }) {
  const intl = useIntl();
  const withAssessment = encounters.filter((e) => e.assessment);
  const latest = withAssessment[0]?.assessment ?? null;
  const earlier = scope === 'all' ? withAssessment.slice(1) : [];
  const hasFindings = (e: MrEncounter) => e.labs.length + e.radiology.length + e.therapy.length > 0;
  const grouped = scope === 'all' ? encounters.filter(hasFindings) : [];

  return (
    <Card title={intl.formatMessage({ id: 'mr.card.history' })} icon="file">
      <div className={styles.columns}>
        <div className={styles.column}>
          <h4 className={styles.subheading}>
            {intl.formatMessage({
              id: scope === 'all' ? 'mr.history.latest' : 'mr.history.heading',
            })}
          </h4>
          {latest ? (
            <AssessmentBlocks a={latest} />
          ) : (
            <p className={pageStyles.empty}>{intl.formatMessage({ id: 'mr.history.empty' })}</p>
          )}
          {earlier.length > 0 && (
            <details className={styles.earlier}>
              <summary>
                {intl.formatMessage({ id: 'mr.history.earlier' }, { count: earlier.length })}
              </summary>
              {earlier.map((e) => (
                <div key={e.no} className={styles.earlierItem}>
                  <GroupHeader e={e} />
                  {e.assessment && <AssessmentBlocks a={e.assessment} />}
                </div>
              ))}
            </details>
          )}
        </div>

        <div className={styles.column}>
          <h4 className={styles.subheading}>
            {intl.formatMessage({
              id: scope === 'all' ? 'mr.support.byEncounter' : 'mr.support.heading',
            })}
          </h4>
          {scope === 'current' ? (
            encounters[0] ? (
              <Findings e={encounters[0]} onOpenTab={onOpenTab} showExam />
            ) : (
              <p className={pageStyles.empty}>{intl.formatMessage({ id: 'mr.history.empty' })}</p>
            )
          ) : (
            <>
              {grouped.slice(0, SUPPORT_GROUPS).map((e) => (
                <Fragment key={e.no}>
                  <GroupHeader e={e} />
                  <Findings e={e} onOpenTab={onOpenTab} showExam={false} />
                </Fragment>
              ))}
              {grouped.length > SUPPORT_GROUPS && (
                <p className={styles.more}>
                  {intl.formatMessage(
                    { id: 'mr.more' },
                    { count: grouped.length - SUPPORT_GROUPS },
                  )}
                  <SupportLinks
                    target="results"
                    label={intl.formatMessage({ id: 'mr.support.viewResults' })}
                    onOpenTab={onOpenTab}
                  />
                </p>
              )}
            </>
          )}
        </div>
      </div>
    </Card>
  );
}

// 3 ─ Clinical notes (allergy pinned, SOAP first) ───────────────────────────────────────────────────────────────────

function AllergyNote({ allergies }: { allergies: Allergy[] }) {
  const intl = useIntl();
  const locale = useLocaleStore((s) => s.locale);
  return (
    <div className={styles.allergy}>
      <Icon name="alert" size={16} />
      <div className={styles.allergyBody}>
        <strong>{intl.formatMessage({ id: 'mr.allergy.title' })}</strong>
        {allergies.length === 0 ? (
          // Not "No known allergies": Khanza cannot tell "none" from "not asked" (patient-medical-record-fields.md §2a.3).
          <span>{intl.formatMessage({ id: 'mr.allergies.empty' })}</span>
        ) : (
          allergies.map((a) => (
            <span key={a.id}>
              {intl.formatMessage(
                { id: 'mr.allergy.line' },
                {
                  allergen: a.allergen,
                  category: enumLabel(intl, 'allergyCategory', a.category),
                  type: enumLabel(intl, 'allergyType', a.type),
                  criticality: enumLabel(intl, 'criticality', a.criticality),
                  status: enumLabel(intl, 'allergyStatus', a.status),
                  verification: enumLabel(intl, 'verification', a.verification),
                  at: formatDateTime(new Date(a.recordedAt), locale),
                },
              )}
            </span>
          ))
        )}
      </div>
    </div>
  );
}

function NoteView({ n }: { n: ClinicalNote }) {
  const intl = useIntl();
  const locale = useLocaleStore((s) => s.locale);
  return (
    <div className={pageStyles.note}>
      <span className={pageStyles.noteHead}>
        {formatDateTime(new Date(n.at), locale)}
        <StatusPill status="neutral">{enumLabel(intl, 'note', n.kind)}</StatusPill>
      </span>
      <span className={pageStyles.muted}>{n.author}</span>
      {n.soap ? (
        (['s', 'o', 'a', 'p'] as const).map((k) => (
          <p key={k} className={pageStyles.soap}>
            <span className={pageStyles.soapKey}>{k.toUpperCase()}</span>
            <span>{n.soap![k]}</span>
          </p>
        ))
      ) : (
        <span>{n.text}</span>
      )}
    </div>
  );
}

/** Newest first; notes that carry SOAP fields are the main entries and keep their full S/O/A/P form. */
const newestFirst = (notes: ClinicalNote[]) => [...notes].sort((a, b) => b.at.localeCompare(a.at));

function NotesCard({ encounters, scope, allergies }: SectionProps & { allergies: Allergy[] }) {
  const intl = useIntl();
  const groups = encounters.filter((e) => e.notes.length > 0);
  return (
    <Card title={intl.formatMessage({ id: 'detail.card.clinicalNotes' })} icon="activity">
      <AllergyNote allergies={allergies} />
      {groups.length === 0 ? (
        <p className={pageStyles.empty}>{intl.formatMessage({ id: 'mr.notes.empty' })}</p>
      ) : (
        groups.map((e) => (
          <div key={e.no} className={styles.noteGroup}>
            {scope === 'all' && <GroupHeader e={e} />}
            {newestFirst(e.notes).map((n) => (
              <NoteView key={n.id} n={n} />
            ))}
          </div>
        ))
      )}
    </Card>
  );
}

// 4 ─ Procedures & interventions ────────────────────────────────────────────────────────────────────────────────────

function ProceduresCard({ encounters, scope }: SectionProps) {
  const intl = useIntl();
  const locale = useLocaleStore((s) => s.locale);
  const rows = encounters.flatMap((e) =>
    [...e.procedures].sort((a, b) => a.at.localeCompare(b.at)).map((p) => ({ e, p })),
  );
  return (
    <Card title={intl.formatMessage({ id: 'mr.card.procedures' })} icon="stethoscope">
      {rows.length === 0 ? (
        <p className={pageStyles.empty}>{intl.formatMessage({ id: 'mr.proc.empty' })}</p>
      ) : (
        <table className={styles.table}>
          <thead>
            <tr>
              <th scope="col">{intl.formatMessage({ id: 'mr.proc.col.at' })}</th>
              <th scope="col">{intl.formatMessage({ id: 'mr.proc.col.name' })}</th>
              <th scope="col">{intl.formatMessage({ id: 'mr.proc.col.by' })}</th>
              <th scope="col">{intl.formatMessage({ id: 'mr.proc.col.icd9' })}</th>
              {scope === 'all' && (
                <th scope="col">{intl.formatMessage({ id: 'mr.dx.col.encounter' })}</th>
              )}
            </tr>
          </thead>
          <tbody>
            {rows.map(({ e, p }) => (
              <tr key={`${e.no}-${p.id}`}>
                <td className={styles.nowrap}>{formatShortDateTime(new Date(p.at), locale)}</td>
                <td>{p.name}</td>
                <td>
                  {enumLabel(intl, 'procRole', p.role)} · {p.by}
                </td>
                <td className={styles.code}>{p.icd9 ?? DASH}</td>
                {scope === 'all' && <td>{encounterLabel(intl, locale, e)}</td>}
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <span className={pageStyles.muted}>{intl.formatMessage({ id: 'mr.proc.note' })}</span>
    </Card>
  );
}

// 5 ─ Treatment and outcomes ────────────────────────────────────────────────────────────────────────────────────────

const orDash = (v: string | null | undefined) => (v && v.length > 0 ? v : DASH);

function OutcomesCard({ encounters, scope }: SectionProps) {
  const intl = useIntl();
  const locale = useLocaleStore((s) => s.locale);
  const title = intl.formatMessage({ id: 'mr.card.outcomes' });
  const open = intl.formatMessage({ id: 'mr.status.open' });
  const stay = (e: MrEncounter) => {
    const o = e.outcome;
    if (!o) return DASH;
    const days =
      o.lengthOfStayDays === null
        ? null
        : intl.formatMessage({ id: 'mr.out.los' }, { count: o.lengthOfStayDays });
    return [o.room, days].filter(Boolean).join(' · ') || DASH;
  };

  if (scope === 'current') {
    const e = encounters[0];
    const o = e?.outcome ?? null;
    return (
      <Card title={title} icon="heart">
        {!e ? (
          <p className={pageStyles.empty}>{intl.formatMessage({ id: 'mr.dx.empty' })}</p>
        ) : e.open || !o ? (
          <NotDischarged />
        ) : (
          <div className={styles.columns}>
            <FieldList>
              <FieldRow
                label={intl.formatMessage({ id: 'mr.out.treatment' })}
                value={orDash(o.treatment)}
              />
              <FieldRow label={intl.formatMessage({ id: 'mr.out.diet' })} value={orDash(o.diet)} />
              <FieldRow label={intl.formatMessage({ id: 'mr.out.room' })} value={stay(e)} />
            </FieldList>
            <FieldList>
              <FieldRow
                label={intl.formatMessage({ id: 'mr.out.condition' })}
                value={enumLabel(intl, 'mrCondition', o.condition)}
              />
              <FieldRow
                label={intl.formatMessage({ id: 'mr.out.leaving' })}
                value={enumLabel(intl, 'mrLeaving', o.wayOfLeaving)}
              />
              <FieldRow
                label={intl.formatMessage({ id: 'mr.out.status' })}
                value={intl.formatMessage({ id: 'mr.status.discharged' })}
              />
            </FieldList>
          </div>
        )}
      </Card>
    );
  }

  return (
    <Card title={title} icon="heart">
      {encounters.length === 0 ? (
        <p className={pageStyles.empty}>{intl.formatMessage({ id: 'mr.dx.empty' })}</p>
      ) : (
        <table className={styles.table}>
          <thead>
            <tr>
              <th scope="col">{intl.formatMessage({ id: 'mr.dx.col.encounter' })}</th>
              <th scope="col">{intl.formatMessage({ id: 'mr.out.treatment' })}</th>
              <th scope="col">{intl.formatMessage({ id: 'mr.out.condition' })}</th>
              <th scope="col">{intl.formatMessage({ id: 'mr.out.leaving' })}</th>
            </tr>
          </thead>
          <tbody>
            {encounters.map((e) => (
              <tr key={e.no}>
                <td>{encounterLabel(intl, locale, e)}</td>
                {e.open || !e.outcome ? (
                  <td colSpan={3} className={pageStyles.muted}>
                    {open}
                  </td>
                ) : (
                  <>
                    <td>{orDash(e.outcome.treatment)}</td>
                    <td>{enumLabel(intl, 'mrCondition', e.outcome.condition)}</td>
                    <td>{enumLabel(intl, 'mrLeaving', e.outcome.wayOfLeaving)}</td>
                  </>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Card>
  );
}

// 6 ─ Discharge plan / follow-up ────────────────────────────────────────────────────────────────────────────────────

function FollowUpCard({ encounters, scope }: SectionProps) {
  const intl = useIntl();
  const locale = useLocaleStore((s) => s.locale);
  const title = intl.formatMessage({ id: 'mr.card.followUp' });
  const none = intl.formatMessage({ id: 'mr.none' });

  if (scope === 'current') {
    const e = encounters[0];
    const f = e?.followUp ?? null;
    return (
      <Card title={title} icon="calendar">
        {!e ? (
          <p className={pageStyles.empty}>{intl.formatMessage({ id: 'mr.dx.empty' })}</p>
        ) : e.open || !f ? (
          <NotDischarged />
        ) : (
          <div className={styles.columns}>
            <FieldList>
              <FieldRow
                label={intl.formatMessage({ id: 'mr.fu.continues' })}
                value={enumLabel(intl, 'mrContinues', f.careContinues)}
              />
              <FieldRow
                label={intl.formatMessage({ id: 'mr.fu.control' })}
                value={orDash(f.controlVisit)}
              />
              <FieldRow
                label={intl.formatMessage({ id: 'mr.fu.referral' })}
                value={f.referral ?? none}
              />
            </FieldList>
            <FieldList>
              <FieldRow
                label={intl.formatMessage({ id: 'mr.fu.takeHome' })}
                value={orDash(f.takeHome)}
              />
              <FieldRow
                label={intl.formatMessage({ id: 'mr.fu.dietEdu' })}
                value={orDash(f.dietEducation)}
              />
              <FieldRow
                label={intl.formatMessage({ id: 'mr.fu.pending' })}
                value={f.pendingResults ?? none}
              />
            </FieldList>
          </div>
        )}
      </Card>
    );
  }

  return (
    <Card title={title} icon="calendar">
      {encounters.length === 0 ? (
        <p className={pageStyles.empty}>{intl.formatMessage({ id: 'mr.dx.empty' })}</p>
      ) : (
        <table className={styles.table}>
          <thead>
            <tr>
              <th scope="col">{intl.formatMessage({ id: 'mr.dx.col.encounter' })}</th>
              <th scope="col">{intl.formatMessage({ id: 'mr.fu.continues' })}</th>
              <th scope="col">{intl.formatMessage({ id: 'mr.fu.control' })}</th>
              <th scope="col">{intl.formatMessage({ id: 'mr.fu.takeHome' })}</th>
            </tr>
          </thead>
          <tbody>
            {encounters.map((e) => (
              <tr key={e.no}>
                <td>{encounterLabel(intl, locale, e)}</td>
                {e.open || !e.followUp ? (
                  <td colSpan={3} className={pageStyles.muted}>
                    {intl.formatMessage({ id: 'mr.status.open' })}
                  </td>
                ) : (
                  <>
                    <td>{enumLabel(intl, 'mrContinues', e.followUp.careContinues)}</td>
                    <td>{orDash(e.followUp.controlVisit)}</td>
                    <td>{orDash(e.followUp.takeHome)}</td>
                  </>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Card>
  );
}

// 7 ─ Digital signature and date ────────────────────────────────────────────────────────────────────────────────────

function SignatureCard({ encounters, scope }: SectionProps): ReactNode {
  const intl = useIntl();
  const locale = useLocaleStore((s) => s.locale);
  return (
    <Card title={intl.formatMessage({ id: 'mr.card.signature' })} icon="shield">
      {encounters.length === 0 ? (
        <p className={pageStyles.empty}>{intl.formatMessage({ id: 'mr.dx.empty' })}</p>
      ) : (
        <table className={styles.table}>
          <thead>
            <tr>
              {scope === 'all' && (
                <th scope="col">{intl.formatMessage({ id: 'mr.dx.col.encounter' })}</th>
              )}
              <th scope="col">{intl.formatMessage({ id: 'mr.sig.col.role' })}</th>
              <th scope="col">{intl.formatMessage({ id: 'mr.sig.col.name' })}</th>
              <th scope="col">{intl.formatMessage({ id: 'mr.sig.col.status' })}</th>
              <th scope="col">{intl.formatMessage({ id: 'mr.sig.col.at' })}</th>
            </tr>
          </thead>
          <tbody>
            {encounters.map((e) => {
              const s = e.signature;
              const signed = s.status === 'signed';
              return (
                <tr key={e.no}>
                  {scope === 'all' && <td>{encounterLabel(intl, locale, e)}</td>}
                  <td>{intl.formatMessage({ id: 'mr.sig.dpjp' })}</td>
                  <td>{s.doctor}</td>
                  <td>
                    {/* A word plus an icon, never colour alone. */}
                    <span className={styles.status} data-signed={signed || undefined}>
                      <Icon name={signed ? 'check' : 'clock'} size={16} />
                      {intl.formatMessage({ id: signed ? 'mr.sig.signed' : 'mr.sig.unsigned' })}
                    </span>
                  </td>
                  <td className={styles.nowrap}>
                    {s.at ? formatDateTime(new Date(s.at), locale) : DASH}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
      <span className={pageStyles.muted}>{intl.formatMessage({ id: 'mr.sig.note' })}</span>
    </Card>
  );
}
