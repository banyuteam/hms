import { useI18n } from '@/locales/I18nProvider';
import { Button } from '@/components/Button';
import {
  labs,
  medicationGiven,
  prescriptions,
  radiology,
  unlinkedRadiologyReports,
  vitals,
  VITAL_KEYS,
} from '@/api/select';
import { DataTable, NotAvailable, Section, TextBlock } from '../components/Blocks';
import { IdentityStrip } from '../components/IdentityStrip';
import { AskAssistant, OpenWindow } from '../components/RecordActions';
import { WindowPage } from '../components/WindowPage';
import { StoredTime, useStoredText } from '@/components/StoredTime';
import { EncounterGate, useOpen } from './EncounterGate';
import { w } from './windowsStyles';

/**
 * W4 Patient Diagnostics & Pharmacy (key: no_rawat): laboratory, radiology, vital signs (from CPPT — the contract
 * has no separate vitals feed), and pharmacy with prescribed · handed over · issued kept apart.
 * Abnormal flags come only from the source (`keterangan`); the UI never compares values with ranges.
 */
export function DiagnosticsWindow({ winId, norawat }: { winId: string; norawat?: string }) {
  const { t } = useI18n();
  const storedText = useStoredText();
  const open = useOpen();

  return (
    <EncounterGate winId={winId} norawat={norawat} blankTitle={t('emr.w4.title')}>
      {({ journey, facts, person }) => {
        const nr = journey.no_rawat;
        const labRows = labs(journey);
        const radRows = radiology(journey);
        const radUnlinked = unlinkedRadiologyReports(journey);
        const vitalRows = vitals(journey);
        const rx = prescriptions(journey);
        const given = medicationGiven(journey);
        const tag = {
          id: `enc:${nr}`,
          kind: 'encounter' as const,
          norawat: nr,
          mrn: facts.mrn ?? undefined,
        };
        const when = (key: string) => <StoredTime value={key} absent={t('emr.undated')} />;

        return (
          <WindowPage
            label={`${t('emr.w4.title')} · ${nr}`}
            identity={(actions) => (
              <IdentityStrip person={person} facts={facts} actions={actions} />
            )}
            sections={[
              { id: 'lab', label: t('emr.lab.title'), count: labRows.length },
              { id: 'rad', label: t('emr.rad.title'), count: radRows.length },
              { id: 'vitals', label: t('emr.vitals.title'), count: vitalRows.length },
              { id: 'pharmacy', label: t('emr.pharmacy.title'), count: rx.length + given.length },
            ]}
            toolbar={
              <>
                <OpenWindow
                  icon="route"
                  label={t('emr.w2.short')}
                  onClick={() => open('emr-records', { norawat: nr })}
                />
                <OpenWindow
                  icon="stethoscope"
                  label={t('emr.w3.short')}
                  onClick={() => open('emr-encounter', { norawat: nr })}
                />
                <AskAssistant tag={tag} />
              </>
            }
          >
            <Section
              id="lab"
              title={t('emr.lab.title')}
              icon="flask"
              count={labRows.length}
              actions={
                <AskAssistant
                  tag={{ ...tag, id: `enc:${nr}:labs`, kind: 'section', section: 'labs' }}
                />
              }
            >
              {labRows.length === 0 ? (
                <NotAvailable reason="recorded" />
              ) : (
                labRows.map((l) => (
                  <div key={l.id} className={w.stack}>
                    <div className={w.itemHead}>
                      <h3 className={w.itemTitle}>
                        {l.test_name ?? '—'} · {when(l.key)}
                      </h3>
                      <Button
                        variant="ghost"
                        onClick={() => open('lab', { norawat: nr, item: l.id })}
                      >
                        {t('emr.open.labViewer')}
                      </Button>
                    </div>
                    <DataTable
                      caption={l.test_name ?? t('emr.lab.title')}
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
                          render: (r) =>
                            r.keterangan ? <span className={w.flag}>{r.keterangan}</span> : '',
                        },
                      ]}
                    />
                  </div>
                ))
              )}
              <p className={w.note}>{t('emr.lab.flagNote')}</p>
            </Section>

            <Section id="rad" title={t('emr.rad.title')} icon="image" count={radRows.length}>
              {radRows.length === 0 && radUnlinked.length === 0 ? (
                <NotAvailable reason="recorded" />
              ) : (
                radRows.map((r) => (
                  <div key={r.id} className={w.stack}>
                    <div className={w.itemHead}>
                      <h3 className={w.itemTitle}>
                        {r.exam_name ?? '—'} · {when(r.key)}
                      </h3>
                      <Button
                        variant="ghost"
                        onClick={() => open('radiology', { norawat: nr, item: r.id })}
                      >
                        {t('emr.open.radViewer')}
                      </Button>
                    </div>
                    <TextBlock label={t('emr.rad.radiologist')} text={r.doctor_name} />
                    <TextBlock label={t('emr.rad.report')} text={r.report} />
                  </div>
                ))
              )}
              {radUnlinked.length > 0 && (
                <>
                  <h3 className={w.columnTitle}>{t('emr.rad.unlinkedTitle')}</h3>
                  <p className={w.note}>{t('emr.rad.unlinkedNote')}</p>
                  {radUnlinked.map((rep) => (
                    <TextBlock
                      key={rep.id}
                      label={t('emr.rad.unlinkedAt', {
                        when: storedText(rep.key) ?? t('emr.undated'),
                      })}
                      text={rep.hasil}
                    />
                  ))}
                </>
              )}
            </Section>

            <Section
              id="vitals"
              title={t('emr.vitals.title')}
              icon="activity"
              count={vitalRows.length}
            >
              <p className={w.note}>{t('emr.vitals.source')}</p>
              {vitalRows.length === 0 ? (
                <NotAvailable reason="recorded" />
              ) : (
                <DataTable
                  caption={t('emr.vitals.title')}
                  rows={vitalRows}
                  rowKey={(n) => `${n.key}-${n.index}`}
                  columns={[
                    {
                      key: 'at',
                      header: t('emr.col.time'),
                      nowrap: true,
                      render: (n) => when(n.key),
                    },
                    ...VITAL_KEYS.map((k) => ({
                      key: k,
                      header: t(`emr.vitals.${k}`),
                      numeric: true,
                      render: (n: (typeof vitalRows)[number]) => n[k] || '—',
                    })),
                    { key: 'by', header: t('emr.col.by'), render: (n) => n.author_name ?? n.nip },
                  ]}
                />
              )}
            </Section>

            <Section
              id="pharmacy"
              title={t('emr.pharmacy.title')}
              icon="pill"
              count={rx.length + given.length}
            >
              <p className={w.note}>{t('emr.pharmacy.states')}</p>
              <h3 className={w.columnTitle}>{t('emr.pharmacy.prescribed')}</h3>
              {rx.length === 0 ? (
                <NotAvailable reason="recorded" />
              ) : (
                <DataTable
                  caption={t('emr.pharmacy.prescribed')}
                  // Compounds (racikan) are prescribed medication too: listed with their single drugs, labelled,
                  // quantity = number of compounded doses as stored (no unit in the source).
                  rows={rx.flatMap((p) => [
                    ...p.items.map((it, i) => ({
                      p,
                      key: `item-${i}`,
                      drug: it.drug_name ?? '—',
                      sig: it.aturan_pakai,
                      qty: `${it.jml ?? '—'} ${it.unit ?? ''}`.trim(),
                    })),
                    ...p.compounds.map((c, i) => ({
                      p,
                      key: `compound-${i}`,
                      drug: t('emr.rx.compoundNamed', { name: c.nama_racik }),
                      sig: c.aturan_pakai,
                      qty: String(c.jml_dr),
                    })),
                  ])}
                  rowKey={(r) => `${r.p.no_resep}-${r.key}`}
                  columns={[
                    {
                      key: 'at',
                      header: t('emr.col.time'),
                      nowrap: true,
                      render: (r) => (
                        <StoredTime
                          value={`${r.p.tgl_peresepan ?? ''} ${r.p.jam_peresepan ?? ''}`}
                          absent="—"
                        />
                      ),
                    },
                    { key: 'd', header: t('emr.rx.drug'), render: (r) => r.drug },
                    { key: 's', header: t('emr.rx.sig'), render: (r) => r.sig || '—' },
                    { key: 'q', header: t('emr.rx.qty'), numeric: true, render: (r) => r.qty },
                    {
                      key: 'h',
                      header: t('emr.pharmacy.handedOver'),
                      nowrap: true,
                      render: (r) => (
                        <StoredTime value={`${r.p.tgl_penyerahan} ${r.p.jam_penyerahan}`} />
                      ),
                    },
                  ]}
                />
              )}
              <h3 className={w.columnTitle}>{t('emr.pharmacy.issued')}</h3>
              {given.length === 0 ? (
                <NotAvailable reason="recorded" />
              ) : (
                <DataTable
                  caption={t('emr.pharmacy.issued')}
                  rows={given}
                  rowKey={(g) => `${g.key}-${g.index}`}
                  columns={[
                    {
                      key: 'at',
                      header: t('emr.col.time'),
                      nowrap: true,
                      render: (g) => when(g.key),
                    },
                    { key: 'd', header: t('emr.rx.drug'), render: (g) => g.drug_name ?? '—' },
                    {
                      key: 'q',
                      header: t('emr.rx.qty'),
                      numeric: true,
                      render: (g) => `${g.jml} ${g.unit ?? ''}`.trim(),
                    },
                    {
                      key: 's',
                      header: t('emr.rx.sig'),
                      render: (g) =>
                        g.dose_instructions
                          .map((d) => d.aturan)
                          .filter(Boolean)
                          .join('; ') || '—',
                    },
                    { key: 'b', header: t('emr.pharmacy.batch'), render: (g) => g.no_batch || '—' },
                    { key: 'w', header: t('emr.pharmacy.ward'), render: (g) => g.ward_name ?? '—' },
                  ]}
                />
              )}
              <p className={w.note}>{t('emr.pharmacy.issuedNote')}</p>
            </Section>
          </WindowPage>
        );
      }}
    </EncounterGate>
  );
}
