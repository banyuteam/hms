import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useIntl } from 'react-intl';
import { ListBox, ListBoxItem, ToggleButton, ToggleButtonGroup } from 'react-aria-components';
import { usePatientEncounters } from '@/api/usePatient';
import type {
  CareType,
  EncounterHistoryItem,
  EncounterStatus,
  TimelineEventKind,
} from '@/api/types';
import { emitAudit } from '@/audit/audit';
import { Button } from '@/components/Button';
import { Icon, type IconName } from '@/components/Icon';
import { MaskedValue } from '@/components/MaskedValue';
import { StatusPill, type PillStatus } from '@/components/StatusPill';
import { formatDate, formatDateTime, formatTime } from '@/i18n/format';
import { useLocaleStore } from '@/i18n/localeStore';
import { enumLabel } from '../labels';
import styles from './EncountersTab.module.css';
import pageStyles from './pages.module.css';

type Filter = 'all' | CareType;

const EVENT_ICON: Record<TimelineEventKind, IconName> = {
  registration: 'clipboard',
  procedure: 'stethoscope',
  visit: 'stethoscope',
  laboratory: 'flask',
  radiology: 'image',
  prescription: 'pill',
  admission: 'bed',
  surgery: 'scissors',
  discharge: 'logout',
};

/** Administrative states stay neutral until the hospital confirms what they mean (OQ-59). */
const STATUS_PILL: Record<EncounterStatus, PillStatus> = {
  registered: 'neutral',
  admitted: 'info',
  completed: 'success',
  cancelled: 'neutral',
  referred: 'warning',
  deceased: 'danger',
  againstAdvice: 'warning',
};

const DASH = '—';

/**
 * Figma mockup 15 / `encounters-tab-fields.md`: encounter list (newest first) beside the selected encounter's header and
 * timeline (oldest first). Read-only. Opening the tab emits an audit event (the backend records the real one).
 * Open points: OQ-59 status labels, OQ-60 attending doctor, OQ-61 shared selection with Medical Record, OQ-62 upcoming group.
 */
export function EncountersTab({ mrn }: { mrn: string }) {
  const intl = useIntl();
  const locale = useLocaleStore((s) => s.locale);
  const { data, isPending, error, refetch } = usePatientEncounters(mrn);
  const [filter, setFilter] = useState<Filter>('all');
  const [selectedNo, setSelectedNo] = useState<string | null>(null);

  useEffect(() => {
    emitAudit('record.open', 'encounters');
  }, []);

  const items = useMemo(
    () => (data ?? []).filter((e) => filter === 'all' || e.care === filter),
    [data, filter],
  );
  // The first encounter is selected on open; a filter that hides the selection falls back to the first visible one.
  const selected: EncounterHistoryItem | undefined =
    items.find((e) => e.no === selectedNo) ?? items[0];

  if (isPending) {
    return (
      <div className={pageStyles.page} role="status" aria-live="polite">
        <p className={pageStyles.empty}>{intl.formatMessage({ id: 'enc.loading' })}</p>
      </div>
    );
  }
  if (error) {
    return (
      <div className={pageStyles.page} role="alert">
        <p>{intl.formatMessage({ id: 'enc.error' })}</p>
        <div>
          <Button onPress={() => void refetch()}>
            {intl.formatMessage({ id: 'detail.retry' })}
          </Button>
        </div>
      </div>
    );
  }
  if (data.length === 0) {
    return (
      <div className={pageStyles.page}>
        <p className={pageStyles.empty}>{intl.formatMessage({ id: 'enc.empty' })}</p>
      </div>
    );
  }

  const at = (iso: string) => new Date(iso);

  return (
    <div className={styles.layout}>
      <aside className={styles.list}>
        <ToggleButtonGroup
          className={pageStyles.scope}
          aria-label={intl.formatMessage({ id: 'enc.filter.label' })}
          selectionMode="single"
          disallowEmptySelection
          selectedKeys={[filter]}
          onSelectionChange={(k) => setFilter(([...k][0] as Filter) ?? 'all')}
        >
          {(['all', 'inpatient', 'outpatient'] as const).map((f) => (
            <ToggleButton key={f} id={f} className={pageStyles.scopeButton}>
              {intl.formatMessage({ id: `enc.filter.${f}` })}
            </ToggleButton>
          ))}
        </ToggleButtonGroup>
        <ListBox
          className={styles.items}
          aria-label={intl.formatMessage({ id: 'enc.list.label' })}
          selectionMode="single"
          disallowEmptySelection
          selectedKeys={selected ? [selected.no] : []}
          onSelectionChange={(k) => {
            const key = [...k][0];
            if (typeof key === 'string') setSelectedNo(key);
          }}
          items={items.map((e) => ({ ...e, id: e.no }))}
          renderEmptyState={() => (
            <p className={pageStyles.empty}>{intl.formatMessage({ id: 'enc.filter.empty' })}</p>
          )}
        >
          {(e) => (
            <ListBoxItem
              id={e.no}
              className={styles.item}
              textValue={`${formatDate(at(e.registeredAt), locale)} ${e.unit}`}
            >
              <span className={styles.itemTop}>
                <span className={styles.itemDate}>{formatDate(at(e.registeredAt), locale)}</span>
                <StatusPill status={STATUS_PILL[e.status]}>
                  {enumLabel(intl, 'encStatus', e.status)}
                </StatusPill>
              </span>
              <span className={styles.itemLine}>
                {enumLabel(intl, 'care', e.care)} · {e.unit}
              </span>
              <span className={styles.itemMuted}>{e.responsibleDoctor}</span>
            </ListBoxItem>
          )}
        </ListBox>
      </aside>

      <section
        className={styles.detail}
        aria-label={intl.formatMessage({ id: 'enc.detail.label' })}
      >
        {selected && (
          <>
            <header className={styles.detailHeader}>
              <div className={styles.titleRow}>
                <h2 className={pageStyles.heading}>
                  {enumLabel(intl, 'care', selected.care)} · {selected.unit}
                </h2>
                {selected.outcome ? (
                  <StatusPill status={selected.outcome === 'deceased' ? 'danger' : 'success'}>
                    {enumLabel(intl, 'outcome', selected.outcome)}
                  </StatusPill>
                ) : (
                  <StatusPill status={STATUS_PILL[selected.status]}>
                    {enumLabel(intl, 'encStatus', selected.status)}
                  </StatusPill>
                )}
              </div>
              <p className={pageStyles.caption}>
                {intl.formatMessage({ id: 'enc.id' }, { no: selected.no })}
              </p>
              <dl className={styles.facts}>
                <Fact
                  label={intl.formatMessage({ id: 'enc.fact.registered' })}
                  value={formatDateTime(at(selected.registeredAt), locale)}
                />
                <Fact
                  label={intl.formatMessage({ id: 'enc.fact.admitted' })}
                  value={
                    selected.admittedAt ? formatDateTime(at(selected.admittedAt), locale) : DASH
                  }
                />
                <Fact
                  label={intl.formatMessage({ id: 'enc.fact.discharged' })}
                  value={
                    selected.dischargedAt ? formatDateTime(at(selected.dischargedAt), locale) : DASH
                  }
                />
                <Fact
                  label={intl.formatMessage({ id: 'enc.fact.los' })}
                  value={
                    selected.lengthOfStayDays === null
                      ? DASH
                      : intl.formatMessage(
                          { id: 'enc.fact.losValue' },
                          { days: selected.lengthOfStayDays },
                        )
                  }
                />
                <Fact label={intl.formatMessage({ id: 'enc.fact.payer' })} value={selected.payer} />
                {selected.sepNo && (
                  <Fact label={intl.formatMessage({ id: 'enc.fact.sep' })}>
                    <MaskedValue
                      field="sep"
                      label={intl.formatMessage({ id: 'enc.fact.sep' })}
                      text={selected.sepNo}
                    />
                  </Fact>
                )}
              </dl>
            </header>

            <h3 className={styles.timelineTitle}>{intl.formatMessage({ id: 'enc.timeline' })}</h3>
            <p className={pageStyles.caption}>{intl.formatMessage({ id: 'enc.timeline.hint' })}</p>
            <ol className={styles.timeline}>
              {selected.timeline.map((ev, i) => {
                const when = at(ev.at);
                const prev = i > 0 ? at(selected.timeline[i - 1]!.at) : null;
                const newDay = !prev || formatDate(prev, locale) !== formatDate(when, locale);
                return (
                  <li key={ev.id} className={styles.event}>
                    <span className={styles.when}>
                      {newDay && (
                        <span className={styles.whenDate}>{formatDate(when, locale)}</span>
                      )}
                      {formatTime(when, locale)}
                    </span>
                    <span className={styles.node} aria-hidden="true">
                      <Icon name={EVENT_ICON[ev.kind]} size={14} />
                    </span>
                    <span className={styles.eventBody}>
                      <span className={styles.eventTitle}>
                        <span className={styles.visuallyHidden}>
                          {enumLabel(intl, 'event', ev.kind)}:{' '}
                        </span>
                        {ev.title}
                      </span>
                      <span className={styles.itemMuted}>
                        {ev.unit}
                        {ev.doctor ? ` · ${ev.doctor}` : ''}
                      </span>
                    </span>
                  </li>
                );
              })}
              {selected.care === 'inpatient' && selected.dischargedAt === null && (
                <li className={`${styles.event} ${styles.open}`}>
                  <span className={styles.when} />
                  <span className={styles.node} aria-hidden="true" />
                  <span className={styles.eventBody}>
                    <span className={styles.itemMuted}>
                      {intl.formatMessage({ id: 'enc.notDischarged' })}
                    </span>
                  </span>
                </li>
              )}
            </ol>
          </>
        )}
      </section>
    </div>
  );
}

function Fact({ label, value, children }: { label: string; value?: string; children?: ReactNode }) {
  return (
    <div className={styles.fact}>
      <dt>{label}</dt>
      <dd>{value ?? children}</dd>
    </div>
  );
}
