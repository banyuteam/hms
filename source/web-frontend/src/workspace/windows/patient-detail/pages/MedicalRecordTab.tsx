import { useEffect, useMemo, useState } from 'react';
import { useIntl } from 'react-intl';
import { ToggleButton, ToggleButtonGroup } from 'react-aria-components';
import type { PatientRecord } from '@/api/types';
import { emitAudit } from '@/audit/audit';
import { Card } from '@/components/Card';
import { FieldList, FieldRow } from '@/components/FieldRow';
import { Icon } from '@/components/Icon';
import { StatusPill } from '@/components/StatusPill';
import { formatDate, formatDateTime } from '@/i18n/format';
import { useLocaleStore } from '@/i18n/localeStore';
import { enumLabel } from '../labels';
import styles from './pages.module.css';

type Scope = 'current' | 'all';

/**
 * Figma "14 Medical Record tab": scope switch + search, then Diagnoses, Medical history, Clinical notes, Allergies.
 * Open to every role for now (OQ-55); opening the tab emits an audit event. Clinical free text is shown as stored (OQ-34).
 */
export function MedicalRecordTab({ patient }: { patient: PatientRecord }) {
  const intl = useIntl();
  const locale = useLocaleStore((s) => s.locale);
  const [scope, setScope] = useState<Scope>('current');
  const [query, setQuery] = useState('');
  const enc = patient.currentEncounter;

  useEffect(() => {
    emitAudit('record.open', 'medical-record');
  }, []);

  const q = query.trim().toLowerCase();
  const inScope = (encounterNo: string) => scope === 'all' || encounterNo === enc.no;

  const diagnoses = useMemo(
    () =>
      patient.diagnoses
        .filter(
          (d) =>
            inScope(d.encounterNo) &&
            (!q || d.code.toLowerCase().includes(q) || d.name.toLowerCase().includes(q)),
        )
        .sort((a, b) =>
          a.encounterNo === b.encounterNo
            ? a.priority - b.priority
            : b.encounterNo.localeCompare(a.encounterNo),
        ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [patient, scope, q],
  );
  const notes = useMemo(
    () =>
      patient.notes
        .filter((n) => {
          if (!inScope(n.encounterNo)) return false;
          if (!q) return true;
          const hay = [n.author, n.text ?? '', n.soap ? Object.values(n.soap).join(' ') : '']
            .join(' ')
            .toLowerCase();
          return hay.includes(q);
        })
        .sort((a, b) => b.at.localeCompare(a.at)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [patient, scope, q],
  );
  const h = patient.history;
  const blocks: Array<[string, string]> = [
    ['field.chiefComplaint', h.chiefComplaint],
    ['field.presentIllness', h.presentIllness],
    ['field.pastIllness', h.pastIllness],
    ['field.familyHistory', h.familyHistory],
    ['field.medicationHistory', h.medicationHistory],
  ];

  return (
    <div className={styles.page}>
      <div className={styles.toolbar}>
        <ToggleButtonGroup
          className={styles.scope}
          aria-label={intl.formatMessage({ id: 'mr.scope.label' })}
          selectionMode="single"
          disallowEmptySelection
          selectedKeys={[scope]}
          onSelectionChange={(k) => setScope(([...k][0] as Scope) ?? 'current')}
        >
          {(['current', 'all'] as const).map((s) => (
            <ToggleButton key={s} id={s} className={styles.scopeButton}>
              {intl.formatMessage({ id: `mr.scope.${s}` })}
            </ToggleButton>
          ))}
        </ToggleButtonGroup>
        <span className={styles.muted}>
          {intl.formatMessage(
            { id: 'mr.context' },
            { no: enc.no, date: formatDate(new Date(enc.admittedAt), locale) },
          )}
        </span>
        <span className={styles.spacer} />
        <label className={styles.search}>
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

      <div className={styles.columns}>
        <div className={styles.stack}>
          <Card title={intl.formatMessage({ id: 'detail.card.diagnoses' })} icon="clipboard">
            {diagnoses.length === 0 ? (
              <p className={styles.empty}>{intl.formatMessage({ id: 'mr.dx.empty' })}</p>
            ) : (
              diagnoses.map((d) => (
                <div key={`${d.encounterNo}-${d.code}`} className={styles.dxRow}>
                  <span className={styles.dxCode}>{d.code}</span>
                  <span className={styles.dxName}>
                    <span>{d.name}</span>
                    <br />
                    <span className={styles.muted}>
                      {intl.formatMessage({ id: `dx.${d.isNew ? 'new' : 'existing'}` })} ·{' '}
                      {enumLabel(intl, 'care', d.care)}
                      {scope === 'all' ? ` · ${d.encounterNo}` : ''}
                    </span>
                  </span>
                  <StatusPill status={d.priority === 1 ? 'info' : 'neutral'}>
                    {intl.formatMessage({ id: d.priority === 1 ? 'dx.primary' : 'dx.secondary' })}
                  </StatusPill>
                </div>
              ))
            )}
            <span className={styles.muted}>{intl.formatMessage({ id: 'mr.dx.codes' })}</span>
          </Card>

          <Card title={intl.formatMessage({ id: 'detail.card.history' })} icon="file">
            {blocks.map(([key, value]) => (
              <div key={key} className={styles.block}>
                <span className={styles.blockLabel}>{intl.formatMessage({ id: key })}</span>
                <span>{value}</span>
              </div>
            ))}
            <span className={styles.muted}>
              {intl.formatMessage(
                { id: 'mr.history.source' },
                { at: formatDateTime(new Date(h.assessedAt), locale) },
              )}
            </span>
          </Card>
        </div>

        <div className={styles.stack}>
          <Card title={intl.formatMessage({ id: 'detail.card.clinicalNotes' })} icon="activity">
            {notes.length === 0 ? (
              <p className={styles.empty}>{intl.formatMessage({ id: 'mr.notes.empty' })}</p>
            ) : (
              notes.map((n) => (
                <div key={n.id} className={styles.note}>
                  <span className={styles.noteHead}>
                    {formatDateTime(new Date(n.at), locale)}
                    <StatusPill status="neutral">{enumLabel(intl, 'note', n.kind)}</StatusPill>
                  </span>
                  <span className={styles.muted}>{n.author}</span>
                  {n.soap ? (
                    (['s', 'o', 'a', 'p'] as const).map((k) => (
                      <p key={k} className={styles.soap}>
                        <span className={styles.soapKey}>{k.toUpperCase()}</span>
                        <span>{n.soap![k]}</span>
                      </p>
                    ))
                  ) : (
                    <span>{n.text}</span>
                  )}
                </div>
              ))
            )}
          </Card>

          <Card title={intl.formatMessage({ id: 'detail.card.allergies' })} icon="alert">
            {patient.allergies.length === 0 ? (
              <p className={styles.empty}>{intl.formatMessage({ id: 'mr.allergies.empty' })}</p>
            ) : (
              patient.allergies.map((a) => (
                <FieldList key={a.id}>
                  <FieldRow
                    label={intl.formatMessage({ id: 'field.allergen' })}
                    value={a.allergen}
                  />
                  <FieldRow
                    label={intl.formatMessage({ id: 'field.reaction' })}
                    value={a.reaction}
                  />
                  <FieldRow
                    label={intl.formatMessage({ id: 'field.category' })}
                    value={enumLabel(intl, 'allergyCategory', a.category)}
                  />
                  <FieldRow
                    label={intl.formatMessage({ id: 'field.type' })}
                    value={enumLabel(intl, 'allergyType', a.type)}
                  />
                  <FieldRow
                    label={intl.formatMessage({ id: 'field.criticality' })}
                    value={enumLabel(intl, 'criticality', a.criticality)}
                  />
                  <FieldRow
                    label={intl.formatMessage({ id: 'field.status' })}
                    value={`${enumLabel(intl, 'allergyStatus', a.status)} · ${enumLabel(intl, 'verification', a.verification)}`}
                  />
                  <FieldRow
                    label={intl.formatMessage({ id: 'field.recorded' })}
                    value={formatDateTime(new Date(a.recordedAt), locale)}
                  />
                </FieldList>
              ))
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}
