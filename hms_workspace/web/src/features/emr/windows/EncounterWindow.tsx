import { useI18n } from '@/locales/I18nProvider';
import {
  admissionOrders,
  emergencyAssessments,
  notes,
  prescriptions,
  surgeries,
  unlinkedSurgeryReports,
} from '@/api/select';
import {
  DataTable,
  NotAvailable,
  RowList,
  Section,
  SummaryRow,
  TextBlock,
} from '../components/Blocks';
import { CpptNote } from '../components/CpptNote';
import { AdmissionOrder, EmergencyAssessment } from '../components/EmergencyAssessment';
import { IdentityStrip } from '../components/IdentityStrip';
import { AskAssistant, EditAction, OpenWindow } from '../components/RecordActions';
import { WindowPage } from '../components/WindowPage';
import { StoredTime, useStoredText } from '@/components/StoredTime';
import { EncounterGate, useOpen } from './EncounterGate';
import { w } from './windowsStyles';

/**
 * W3 Patient Medical Encounter (key: no_rawat): what the clinicians wrote — CPPT (newest first, for rounds and
 * handover), the emergency medical assessment and the inpatient admission order (only when the visit has them),
 * diagnoses, prescriptions, treatment plan, surgery. Doctor sees draft-only edit actions.
 */
export function EncounterWindow({ winId, norawat }: { winId: string; norawat?: string }) {
  const { t } = useI18n();
  const storedText = useStoredText();
  const open = useOpen();

  return (
    <EncounterGate winId={winId} norawat={norawat} blankTitle={t('emr.w3.title')}>
      {({ journey, facts, person }) => {
        const nr = journey.no_rawat;
        const cppt = notes(journey, 'desc');
        const dx = [...journey.summary.diagnoses].sort((a, b) => a.prioritas - b.prioritas);
        const rx = prescriptions(journey);
        const ops = surgeries(journey);
        const opsUnlinked = unlinkedSurgeryReports(journey);
        const igd = emergencyAssessments(journey);
        const orders = admissionOrders(journey);
        const latestPlan = cppt.find((n) => (n.rtl ?? '').trim() || n.instruksi.trim());
        const tag = {
          id: `enc:${nr}`,
          kind: 'encounter' as const,
          norawat: nr,
          mrn: facts.mrn ?? undefined,
        };

        return (
          <WindowPage
            label={`${t('emr.w3.title')} · ${nr}`}
            identity={(actions) => (
              <IdentityStrip person={person} facts={facts} actions={actions} />
            )}
            sections={[
              { id: 'cppt', label: t('emr.cppt.title'), count: cppt.length },
              ...(igd.length > 0 ? [{ id: 'igd', label: t('emr.igd.title') }] : []),
              ...(orders.length > 0
                ? [{ id: 'admission', label: t('emr.admissionOrder.title') }]
                : []),
              { id: 'diagnoses', label: t('emr.dx.title'), count: dx.length },
              { id: 'rx', label: t('emr.rx.title'), count: rx.length },
              { id: 'plan', label: t('emr.plan.title') },
              { id: 'surgery', label: t('emr.surgery.title'), count: ops.length },
            ]}
            toolbar={
              <>
                <OpenWindow
                  icon="route"
                  label={t('emr.w2.short')}
                  onClick={() => open('emr-records', { norawat: nr })}
                />
                <OpenWindow
                  icon="flask"
                  label={t('emr.w4.short')}
                  onClick={() => open('emr-diagnostics', { norawat: nr })}
                />
                <AskAssistant tag={tag} />
              </>
            }
          >
            <Section
              id="cppt"
              title={t('emr.cppt.title')}
              icon="clipboard"
              count={cppt.length}
              actions={
                <>
                  <EditAction label={t('emr.edit.newCppt')} icon="plus" />
                  <AskAssistant
                    tag={{ ...tag, id: `enc:${nr}:cppt`, kind: 'section', section: 'cppt' }}
                  />
                </>
              }
            >
              <p className={w.note}>{t('emr.cppt.order')}</p>
              {cppt.length === 0 ? (
                <NotAvailable reason="recorded" />
              ) : (
                cppt.map((n) => <CpptNote key={`${n.key}-${n.index}`} note={n} />)
              )}
            </Section>

            {igd.length > 0 && (
              <Section id="igd" title={t('emr.igd.title')} icon="clipboardCheck">
                {igd.map((a) => (
                  <EmergencyAssessment key={`${a.key}-${a.index}`} a={a} />
                ))}
              </Section>
            )}

            {orders.length > 0 && (
              <Section id="admission" title={t('emr.admissionOrder.title')} icon="forward">
                {orders.map((o) => (
                  <AdmissionOrder key={`${o.key}-${o.index}`} o={o} />
                ))}
              </Section>
            )}

            <Section
              id="diagnoses"
              title={t('emr.dx.title')}
              icon="stethoscope"
              count={dx.length}
              actions={<EditAction label={t('emr.edit.addDx')} icon="plus" />}
            >
              {dx.length === 0 ? (
                <NotAvailable reason="recorded" />
              ) : (
                <DataTable
                  caption={t('emr.dx.title')}
                  rows={dx}
                  rowKey={(d) => `${d.kd_penyakit}-${d.prioritas}`}
                  columns={[
                    {
                      key: 'p',
                      header: t('emr.dx.priority'),
                      render: (d) =>
                        d.prioritas === 1 ? t('emr.dx.primary') : t('emr.dx.secondary'),
                    },
                    {
                      key: 'c',
                      header: t('emr.dx.icd10'),
                      render: (d) => <span className={w.code}>{d.kd_penyakit}</span>,
                    },
                    { key: 'n', header: t('emr.dx.name'), render: (d) => d.diagnosis_name ?? '—' },
                  ]}
                />
              )}
            </Section>

            <Section
              id="rx"
              title={t('emr.rx.title')}
              icon="pill"
              count={rx.length}
              actions={<EditAction label={t('emr.edit.newRx')} icon="plus" />}
            >
              {rx.length === 0 ? (
                <NotAvailable reason="recorded" />
              ) : (
                <RowList>
                  {rx.map((p) => (
                    <SummaryRow
                      key={p.no_resep}
                      icon="pill"
                      label={
                        <StoredTime
                          value={`${p.tgl_peresepan ?? ''} ${p.jam_peresepan ?? ''}`}
                          absent={p.no_resep}
                        />
                      }
                      count={p.items.length + p.compounds.length}
                      preview={`${p.doctor_name ?? '—'} · ${[
                        ...p.items.map((it) => `${it.drug_name ?? '—'} ${it.aturan_pakai}`),
                        ...p.compounds.map((c) => `${c.nama_racik} ${c.aturan_pakai}`),
                      ].join('; ')}`}
                      onOpen={() => open('prescription', { norawat: nr, item: p.no_resep })}
                      openLabel={t('emr.open.rxViewer')}
                    />
                  ))}
                </RowList>
              )}
            </Section>

            <Section
              id="plan"
              title={t('emr.plan.title')}
              icon="listChecks"
              actions={<EditAction label={t('emr.edit.plan')} />}
            >
              {!latestPlan ? (
                <NotAvailable reason="recorded" />
              ) : (
                <>
                  <p className={w.note}>
                    {t('emr.plan.from', {
                      when: storedText(latestPlan.key) ?? '—',
                      author: latestPlan.author_name ?? latestPlan.nip,
                    })}
                  </p>
                  <TextBlock label={t('emr.cppt.p')} text={latestPlan.rtl} />
                  <TextBlock label={t('emr.cppt.i')} text={latestPlan.instruksi} />
                </>
              )}
            </Section>

            <Section id="surgery" title={t('emr.surgery.title')} icon="scissors" count={ops.length}>
              {ops.length === 0 && opsUnlinked.length === 0 ? (
                <NotAvailable reason="recorded" />
              ) : (
                ops.map((o) => (
                  <div key={`${o.key}-${o.index}`} className={w.stack}>
                    <TextBlock label={t('emr.surgery.name')} text={o.surgery_name} />
                    <TextBlock
                      label={t('emr.surgery.team')}
                      text={[o.operator1_name, o.anesthetist_name].filter(Boolean).join(' · ')}
                    />
                    <TextBlock label={t('emr.surgery.anaesthesia')} text={o.jenis_anasthesi} />
                    <TextBlock label={t('emr.surgery.preop')} text={o.report?.diagnosa_preop} />
                    <TextBlock label={t('emr.surgery.postop')} text={o.report?.diagnosa_postop} />
                    <TextBlock label={t('emr.surgery.report')} text={o.report?.laporan_operasi} />
                  </div>
                ))
              )}
              {opsUnlinked.length > 0 && (
                <>
                  <h3 className={w.columnTitle}>{t('emr.surgery.unlinkedTitle')}</h3>
                  <p className={w.note}>{t('emr.surgery.unlinkedNote')}</p>
                  {opsUnlinked.map((r) => (
                    <div key={r.id} className={w.stack}>
                      <p className={w.note}>
                        {t('emr.surgery.unlinkedAt', {
                          when: storedText(r.key) ?? t('emr.undated'),
                        })}
                      </p>
                      <TextBlock label={t('emr.surgery.preop')} text={r.diagnosa_preop} />
                      <TextBlock label={t('emr.surgery.postop')} text={r.diagnosa_postop} />
                      <TextBlock label={t('emr.surgery.report')} text={r.laporan_operasi} />
                    </div>
                  ))}
                </>
              )}
            </Section>
          </WindowPage>
        );
      }}
    </EncounterGate>
  );
}
