import { useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { useIntl } from 'react-intl';
import { ToggleButton, ToggleButtonGroup } from 'react-aria-components';
import { Icon } from '@/components/Icon';
import { StatusPill, type PillStatus } from '@/components/StatusPill';
import { SYNTHETIC_PATIENTS, type PatientStatus } from '@/data/syntheticPatients';
import styles from './PatientManagementWindow.module.css';

type Filter = 'all' | PatientStatus;
const FILTERS: Filter[] = ['all', 'outpatient', 'inpatient', 'emergency'];
const PILL: Record<PatientStatus, PillStatus> = {
  outpatient: 'neutral',
  inpatient: 'info',
  emergency: 'danger',
  discharged: 'success',
};

/** Figma "03 Manajemen Pasien": toolbar (search + status filter) + table. Synthetic data only. */
export function PatientManagementWindow() {
  const intl = useIntl();
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [selected, setSelected] = useState<string | null>('00012346');
  const rows = useRef<Array<HTMLTableRowElement | null>>([]);

  const patients = useMemo(() => {
    const q = query.trim().toLowerCase();
    return SYNTHETIC_PATIENTS.filter(
      (p) =>
        (filter === 'all' || p.status === filter) &&
        (!q || p.name.toLowerCase().includes(q) || p.mrn.includes(q)),
    );
  }, [query, filter]);

  const onRowKey = (e: KeyboardEvent<HTMLTableRowElement>, index: number, mrn: string) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      rows.current[Math.min(index + 1, patients.length - 1)]?.focus();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      rows.current[Math.max(index - 1, 0)]?.focus();
    } else if (e.key === 'Home') {
      e.preventDefault();
      rows.current[0]?.focus();
    } else if (e.key === 'End') {
      e.preventDefault();
      rows.current[patients.length - 1]?.focus();
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      setSelected(mrn);
    }
  };

  const statusLabel = (s: PatientStatus) => intl.formatMessage({ id: `patients.status.${s}` });

  return (
    <div className={styles.root}>
      <div className={styles.toolbar}>
        <label className={styles.search}>
          <Icon name="search" />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={intl.formatMessage({ id: 'patients.search.placeholder' })}
            aria-label={intl.formatMessage({ id: 'patients.search.label' })}
          />
        </label>
        <ToggleButtonGroup
          aria-label={intl.formatMessage({ id: 'patients.filter.label' })}
          selectionMode="single"
          disallowEmptySelection
          selectedKeys={[filter]}
          onSelectionChange={(k) => setFilter(([...k][0] as Filter) ?? 'all')}
          className={styles.filters}
        >
          {FILTERS.map((f) => (
            <ToggleButton key={f} id={f} className={styles.filter}>
              {f === 'all' ? intl.formatMessage({ id: 'patients.filter.all' }) : statusLabel(f)}
            </ToggleButton>
          ))}
        </ToggleButtonGroup>
      </div>

      <div className={styles.tableWrap}>
        <table
          className={styles.table}
          aria-label={intl.formatMessage({ id: 'patients.table.label' })}
        >
          <thead>
            <tr>
              {(['mrn', 'name', 'ageSex', 'insurer', 'service', 'doctor', 'status'] as const).map(
                (c) => (
                  <th key={c} scope="col">
                    {intl.formatMessage({ id: `patients.col.${c}` })}
                  </th>
                ),
              )}
            </tr>
          </thead>
          <tbody>
            {patients.map((p, i) => (
              <tr
                key={p.mrn}
                ref={(el) => {
                  rows.current[i] = el;
                }}
                tabIndex={i === 0 ? 0 : -1}
                aria-selected={selected === p.mrn}
                data-selected={selected === p.mrn || undefined}
                onClick={() => setSelected(p.mrn)}
                onKeyDown={(e) => onRowKey(e, i, p.mrn)}
              >
                <td>{p.mrn}</td>
                <th scope="row" className={styles.name}>
                  {p.name}
                </th>
                <td>
                  {intl.formatMessage({ id: 'patients.ageSex' }, { years: p.age, sex: p.sex })}
                </td>
                <td>{p.insurer}</td>
                <td>{p.service}</td>
                <td>{p.doctor}</td>
                <td>
                  <StatusPill status={PILL[p.status]}>{statusLabel(p.status)}</StatusPill>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {patients.length === 0 && (
          <p className={styles.empty}>{intl.formatMessage({ id: 'patients.empty' })}</p>
        )}
      </div>

      <footer className={styles.footer}>
        <span aria-live="polite">
          {intl.formatMessage(
            { id: 'patients.count' },
            { shown: patients.length, total: SYNTHETIC_PATIENTS.length },
          )}
        </span>
        <span>{intl.formatMessage({ id: 'patients.synthetic' })}</span>
      </footer>
    </div>
  );
}
