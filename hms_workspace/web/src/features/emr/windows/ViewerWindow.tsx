import { useEffect, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useI18n } from '@/locales/I18nProvider';
import { formatStoredDate } from '@/locales/storedTime';
import { Button } from '@/components/Button';
import { Icon, type IconName } from '@/components/Icon';
import type { EncounterJourney } from '@/api/journey';
import { facts as toFacts, labs, prescriptions, radiology } from '@/api/select';
import {
  DataTable,
  NotAvailable,
  RowList,
  Section,
  SummaryRow,
  TextBlock,
} from '../components/Blocks';
import { BillCharges } from '../components/BillCharges';
import { IdentityStrip, type IdentityPerson } from '../components/IdentityStrip';
import { AskAssistant } from '../components/RecordActions';
import { WindowPage } from '../components/WindowPage';
import { StoredTime, useStoredText } from '@/components/StoredTime';
import { EncounterGate, useOpen, type EncounterView } from './EncounterGate';
import { w } from './windowsStyles';

export type ViewerKind = 'lab' | 'radiology' | 'prescription' | 'billing';

const ICON: Record<ViewerKind, IconName> = {
  lab: 'flask',
  radiology: 'image',
  prescription: 'pill',
  billing: 'receipt',
};

interface Pickable {
  id: string;
  label: string;
  preview: string;
}

function pickables(kind: ViewerKind, j: EncounterJourney, when: (k: string) => string): Pickable[] {
  if (kind === 'lab')
    return labs(j).map((l) => ({ id: l.id, label: when(l.key), preview: l.test_name ?? '—' }));
  if (kind === 'radiology')
    return radiology(j).map((r) => ({ id: r.id, label: when(r.key), preview: r.exam_name ?? '—' }));
  if (kind === 'prescription')
    return prescriptions(j).map((p) => ({
      id: p.no_resep,
      label: when(p.key),
      preview: [
        ...p.items.map((i) => i.drug_name ?? '—'),
        ...p.compounds.map((c) => c.nama_racik),
      ].join('; '),
    }));
  return [{ id: 'summary', label: j.no_rawat, preview: '' }];
}

/**
 * Multi-function viewer (lab · radiology · prescription · billing). Standalone module windows hidden from Home,
 * opened as quick viewers from W2/W3/W4 or from the module menu. Blank → search by no_rawat (encounter_id);
 * an encounter without an item lists the objects, and each object opens its own viewer instance.
 */
export function ViewerWindow({
  winId,
  kind,
  norawat,
  item,
}: {
  winId: string;
  kind: ViewerKind;
  norawat?: string;
  item?: string;
}) {
  const { t } = useI18n();
  return (
    <EncounterGate winId={winId} norawat={norawat} blankTitle={t(`emr.viewer.${kind}.title`)}>
      {(view) => <ViewerBody kind={kind} item={item} view={view} />}
    </EncounterGate>
  );
}

function ViewerBody({
  kind,
  item,
  view,
}: {
  kind: ViewerKind;
  item?: string;
  view: EncounterView;
}) {
  const { t } = useI18n();
  const storedText = useStoredText();
  const open = useOpen();
  const [printing, setPrinting] = useState(false);
  const { journey, facts, person } = view;
  const nr = journey.no_rawat;
  // Titles and list labels are text: an invalid time shows the warning text there.
  const when = (k: string) => storedText(k, t('emr.undated')) ?? t('emr.undated');
  const title = t(`emr.viewer.${kind}.title`);
  const items = pickables(kind, journey, when);
  const tag = {
    id: `enc:${nr}:${kind}:${item ?? ''}`,
    kind: 'section' as const,
    norawat: nr,
    section: kind,
  };

  const body = (() => {
    if (!item) {
      return (
        <Section id="pick" title={t('emr.viewer.pick')} icon={ICON[kind]} count={items.length}>
          {items.length === 0 ? (
            <NotAvailable reason="recorded" />
          ) : (
            <RowList>
              {items.map((it) => (
                <SummaryRow
                  key={it.id}
                  icon={ICON[kind]}
                  label={it.label}
                  preview={it.preview}
                  onOpen={() => open(kind, { norawat: nr, item: it.id })}
                  openLabel={title}
                />
              ))}
            </RowList>
          )}
        </Section>
      );
    }
    if (kind === 'lab') {
      const l = labs(journey).find((x) => x.id === item);
      if (!l) return <NotAvailable reason="recorded" />;
      return (
        <Section
          id="detail"
          title={`${l.test_name ?? '—'} · ${when(l.key)}`}
          icon="flask"
          count={l.results.length}
        >
          <DataTable
            caption={l.test_name ?? title}
            rows={l.results}
            rowKey={(r) => String(r.id_template)}
            columns={[
              { key: 'i', header: t('emr.lab.item'), render: (r) => r.item_name ?? '—' },
              {
                key: 'v',
                header: t('emr.lab.value'),
                numeric: true,
                render: (r) => `${r.nilai} ${r.unit ?? ''}`.trim(),
              },
              {
                key: 'r',
                header: t('emr.lab.range'),
                render: (r) => r.nilai_rujukan || t('emr.lab.noRange'),
              },
              {
                key: 'f',
                header: t('emr.lab.flag'),
                render: (r) => (r.keterangan ? <span className={w.flag}>{r.keterangan}</span> : ''),
              },
            ]}
          />
          <TextBlock label={t('emr.lab.validatedBy')} text={l.doctor_name} />
          <TextBlock label={t('emr.lab.referrer')} text={l.referring_doctor_name} />
          <p className={w.note}>{t('emr.lab.flagNote')}</p>
        </Section>
      );
    }
    if (kind === 'radiology') {
      const r = radiology(journey).find((x) => x.id === item);
      if (!r) return <NotAvailable reason="recorded" />;
      return (
        <Section id="detail" title={`${r.exam_name ?? '—'} · ${when(r.key)}`} icon="image">
          <div className={w.media} role="img" aria-label={t('emr.rad.imageNA')}>
            <Icon name="image" size={24} />
            <p>{t('emr.rad.imageNA')}</p>
          </div>
          <TextBlock label={t('emr.rad.projection')} text={r.proyeksi} />
          <TextBlock label={t('emr.rad.radiologist')} text={r.doctor_name} />
          <TextBlock label={t('emr.rad.report')} text={r.report} />
        </Section>
      );
    }
    if (kind === 'prescription') {
      const p = prescriptions(journey).find((x) => x.no_resep === item);
      if (!p) return <NotAvailable reason="recorded" />;
      return (
        <Section
          id="detail"
          title={t('emr.viewer.rxNo', { no: p.no_resep })}
          icon="pill"
          count={p.items.length + p.compounds.length}
        >
          <TextBlock label={t('emr.rx.prescriber')} text={p.doctor_name} />
          <TextBlock
            label={t('emr.rx.prescribedAt')}
            text={<StoredTime value={`${p.tgl_peresepan ?? ''} ${p.jam_peresepan ?? ''}`} />}
          />
          <TextBlock
            label={t('emr.pharmacy.handedOver')}
            text={<StoredTime value={`${p.tgl_penyerahan} ${p.jam_penyerahan}`} />}
          />
          <DataTable
            caption={title}
            rows={p.items}
            rowKey={(it, i) => `${it.kode_brng ?? ''}-${i}`}
            columns={[
              { key: 'd', header: t('emr.rx.drug'), render: (it) => it.drug_name ?? '—' },
              { key: 's', header: t('emr.rx.sig'), render: (it) => it.aturan_pakai || '—' },
              {
                key: 'q',
                header: t('emr.rx.qty'),
                numeric: true,
                render: (it) => `${it.jml ?? '—'} ${it.unit ?? ''}`.trim(),
              },
            ]}
          />
          {p.compounds.map((c) => (
            <TextBlock
              key={c.nama_racik}
              label={t('emr.rx.compound')}
              text={`${c.nama_racik} — ${c.aturan_pakai} (${c.jml_dr})`}
            />
          ))}
        </Section>
      );
    }
    // Billing summary (document): visit facts from the timeline, charges from the saved bill (billing.read).
    return (
      <Section
        id="detail"
        title={t('emr.viewer.billing.title')}
        icon="receipt"
        actions={
          <Button variant="secondary" onClick={() => setPrinting(true)}>
            <Icon name="printer" size={16} />
            {t('emr.viewer.print')}
          </Button>
        }
      >
        <BillingDocument journey={journey} person={person} />
        {printing && (
          <PrintOnly onDone={() => setPrinting(false)}>
            <BillingDocument journey={journey} person={person} />
          </PrintOnly>
        )}
      </Section>
    );
  })();

  return (
    <WindowPage
      label={`${title} · ${nr}${item ? ` · ${item}` : ''}`}
      identity={(actions) => <IdentityStrip person={person} facts={facts} actions={actions} />}
      sections={[]}
      toolbar={
        <>
          {item && kind !== 'billing' && (
            <Button variant="ghost" onClick={() => open(kind, { norawat: nr })}>
              <Icon name="arrowLeft" size={16} />
              {t('emr.viewer.all')}
            </Button>
          )}
          <AskAssistant tag={tag} />
        </>
      }
    >
      {body}
    </WindowPage>
  );
}

/**
 * The bill as a document: who it belongs to (name, MRN, date of birth: two identifiers), the visit, diagnoses and
 * procedures, then the charges. The same component is printed on its own (`PrintOnly`).
 */
function BillingDocument({
  journey,
  person,
}: {
  journey: EncounterJourney;
  person: IdentityPerson;
}) {
  const { t, locale } = useI18n();
  const f = toFacts(journey);
  const nr = journey.no_rawat;
  const dob = formatStoredDate(person.birthDate, locale);
  return (
    <article className={w.doc} aria-label={t('emr.viewer.billing.title')}>
      <h3 className={w.docTitle}>{t('emr.viewer.billing.docTitle')}</h3>
      <TextBlock label={t('field.fullName')} text={person.name} />
      <TextBlock label={t('field.mrn')} text={person.mrn ?? f.mrn} />
      <TextBlock label={t('field.birthDate')} text={dob} />
      <TextBlock label={t('emr.identity.norawatLabel')} text={nr} />
      <TextBlock label={t('emr.stay.admitted')} text={<StoredTime value={f.admittedKey} />} />
      <TextBlock label={t('emr.stay.discharged')} text={<StoredTime value={f.discharged} />} />
      <TextBlock
        label={t('emr.stay.los')}
        text={f.lengthOfStay !== null ? t('emr.stay.days', { n: f.lengthOfStay }) : null}
      />
      <TextBlock label={t('emr.identity.payerLabel')} text={f.payer} />
      {f.payerType === 'bpjs' && (
        <TextBlock
          label={t('emr.sep.no')}
          text={
            f.sep.state === 'present'
              ? f.sep.records.map((r) => r.no_sep).join('\n')
              : t(f.sep.state === 'none' ? 'emr.sep.none' : 'emr.na.source')
          }
        />
      )}
      <TextBlock
        label={t('emr.dx.title')}
        text={journey.summary.diagnoses
          .map((d) => `${d.kd_penyakit} ${d.diagnosis_name ?? ''}`)
          .join('\n')}
      />
      <TextBlock
        label={t('emr.px.title')}
        text={journey.summary.coded_procedures
          .map((p) => `${p.kode} ${p.procedure_name ?? ''}`)
          .join('\n')}
      />
      <BillCharges norawat={nr} />
    </article>
  );
}

/**
 * Prints only `children`: they are rendered in a layer of their own next to the app, and the print stylesheet
 * (`styles/index.css`, `.hms-print-root`) hides everything else, so other open windows (other patients) never reach the
 * paper. The layer is removed once the print dialog closes.
 */
function PrintOnly({ children, onDone }: { children: ReactNode; onDone: () => void }) {
  useEffect(() => {
    window.addEventListener('afterprint', onDone);
    window.print();
    return () => window.removeEventListener('afterprint', onDone);
  }, [onDone]);
  return createPortal(<div className="hms-print-root">{children}</div>, document.body);
}
