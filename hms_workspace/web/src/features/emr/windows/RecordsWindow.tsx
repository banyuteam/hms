import type { ReactNode } from 'react';
import { useI18n } from '@/locales/I18nProvider';
import { Button } from '@/components/Button';
import { FieldList, FieldRow } from '@/components/FieldRow';
import { Icon } from '@/components/Icon';
import { StatusPill } from '@/components/StatusPill';
import type { JourneyMoment } from '@/api/journey';
import { isLiveApi } from '@/api/liveApi';
import { isBpjs, labs, moments, radiology } from '@/api/select';
import { CLAIM_PERMISSION, claimErrorKind, useClaimEvaluation } from '@/api/claimApi';
import { viewFinding } from '@/features/assistant/claimView';
import { usePermission } from '@/state/auth';
import {
  DataTable,
  NotAvailable,
  RowList,
  Section,
  SummaryRow,
  TextBlock,
} from '../components/Blocks';
import { IdentityStrip } from '../components/IdentityStrip';
import { SepDetails } from '../components/SepDetails';
import { AskAi, EditAction, OpenWindow } from '../components/RecordActions';
import { WindowPage } from '../components/WindowPage';
import { formatStored } from '@/locales/storedTime';
import { StoredTime } from '@/components/StoredTime';
import { EncounterGate, useOpen } from './EncounterGate';
import { w } from './windowsStyles';

type ClaimResult = ReturnType<typeof useClaimEvaluation>;

/**
 * Claim readiness as evaluated by hms_services (assistant-v1, ADR-SVC-006): the browser only shows the findings. Every
 * state says what happened; a failure never looks like a passed check.
 */
function ClaimChecks({ claim, allowed }: { claim: ClaimResult; allowed: boolean }) {
  const { t } = useI18n();
  if (!allowed) return <p className={w.note}>{t('emr.claim.error.forbidden')}</p>;
  if (claim.isPending) return <p className={w.note}>{t('emr.claim.checking')}</p>;
  if (claim.isError || !claim.data)
    return (
      <div className="flex flex-wrap items-center gap-12" role="alert">
        <p className={w.note}>{t(`emr.claim.error.${claimErrorKind(claim.error)}`)}</p>
        <Button variant="secondary" onClick={() => void claim.refetch()}>
          {t('detail.retry')}
        </Button>
      </div>
    );
  const e = claim.data;
  return (
    <>
      <p className={w.note}>{t('emr.claim.intro')}</p>
      <ul className={w.checks}>
        {e.findings.map((f) => {
          const v = viewFinding(t, f);
          return (
            <li key={f.rule_id}>
              <span className="flex flex-col gap-2">
                <span>{v.label}</span>
                {v.note && <span className={w.note}>{v.note}</span>}
              </span>
              <StatusPill status={v.pill}>{v.state}</StatusPill>
            </li>
          );
        })}
      </ul>
      {e.status === 'partial' && <p className={w.note}>{t('emr.claim.partial')}</p>}
      <p className={w.note}>{t('emr.claim.scope')}</p>
    </>
  );
}

/**
 * W2 Medical Records (key: no_rawat). Datetime-first timeline admission → discharge; every row drills down
 * into W3/W4 or a viewer window. Undated summary segments (codes, discharge summary) follow the timeline.
 * Timeline is oldest-first: it tells the story of the stay.
 */
export function RecordsWindow({ winId, norawat }: { winId: string; norawat?: string }) {
  const { t, locale } = useI18n();
  const open = useOpen();
  // The server authorizes; the permission only avoids a request it would refuse (demo data needs none).
  const claimAllowed = usePermission(CLAIM_PERMISSION) || !isLiveApi();
  const claim = useClaimEvaluation(norawat, claimAllowed);
  // No claim for the visit's payer (the server decides): the section is left out, as before.
  const claimable = claim.data?.status !== 'not_applicable';

  return (
    <EncounterGate winId={winId} norawat={norawat} blankTitle={t('emr.w2.title')} patientSearch>
      {({ journey, facts, person }) => {
        const all = moments(journey);
        const labRows = labs(journey);
        const radRows = radiology(journey);
        const dx = [...journey.summary.diagnoses].sort((a, b) => a.prioritas - b.prioritas);
        const px = [...journey.summary.coded_procedures].sort((a, b) => a.prioritas - b.prioritas);
        const ds = journey.summary.discharge_summary_inpatient;
        // The discharge summary (resume medis) belongs to inpatient stays. It is still shown when one is recorded on a
        // visit not marked inpatient: recorded clinical data is never hidden.
        const showDischarge = facts.careSetting === 'inpatient' || Boolean(ds);
        // SEP records are shown for BPJS visits (payer code BPJ) only.
        const bpjs = isBpjs(facts.payerCode);
        const nr = journey.no_rawat;
        const tag = {
          id: `enc:${nr}`,
          kind: 'encounter' as const,
          norawat: nr,
          mrn: facts.mrn ?? undefined,
        };

        const rowsFor = (key: string, m: JourneyMoment) => {
          const rows: ReactNode[] = [];
          m.registration?.forEach((r, i) =>
            rows.push(
              <SummaryRow
                key={`reg${i}`}
                icon="file"
                label={t('emr.seg.registration')}
                preview={[r.department_name, r.doctor_name, r.payer_name]
                  .filter(Boolean)
                  .join(' · ')}
              />,
            ),
          );
          m.room_stay?.forEach((r, i) =>
            rows.push(
              <SummaryRow
                key={`room${i}`}
                icon="bed"
                label={t('emr.seg.roomStay')}
                preview={[r.ward_name, r.room_class, r.diagnosa_awal].filter(Boolean).join(' · ')}
              />,
            ),
          );
          m.clinical_notes?.forEach((n, i) =>
            rows.push(
              <SummaryRow
                key={`cppt${i}`}
                icon="clipboard"
                label={t('emr.seg.cppt')}
                preview={`${n.author_name ?? n.nip}: ${n.penilaian.split('\n')[0] ?? ''}`}
                onOpen={() => open('emr-encounter', { norawat: nr })}
                openLabel={t('emr.open.encounter')}
              />,
            ),
          );
          m.clinical_notes
            ?.filter((n) => n.tensi || n.nadi || n.spo2)
            .forEach((n, i) =>
              rows.push(
                <SummaryRow
                  key={`vit${i}`}
                  icon="activity"
                  label={t('emr.seg.vitals')}
                  preview={[
                    n.tensi && `${t('emr.vitals.tensi')} ${n.tensi}`,
                    n.nadi && `${t('emr.vitals.nadi')} ${n.nadi}`,
                    n.spo2 && `${t('emr.vitals.spo2')} ${n.spo2}`,
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                  onOpen={() => open('emr-diagnostics', { norawat: nr })}
                  openLabel={t('emr.open.diagnostics')}
                />,
              ),
            );
          labRows
            .filter((l) => l.key === key)
            .forEach((l) => {
              const flagged = l.results.filter((r) => r.keterangan.trim() !== '').length;
              rows.push(
                <SummaryRow
                  key={l.id}
                  icon="flask"
                  label={t('emr.seg.lab')}
                  preview={`${l.test_name ?? '—'}${flagged ? ` · ${t('emr.lab.flaggedBySource', { n: flagged })}` : ''}`}
                  onOpen={() => open('lab', { norawat: nr, item: l.id })}
                  openLabel={t('emr.open.labViewer')}
                />,
              );
            });
          radRows
            .filter((r) => r.key === key)
            .forEach((r) =>
              rows.push(
                <SummaryRow
                  key={r.id}
                  icon="image"
                  label={t('emr.seg.radiology')}
                  preview={`${r.exam_name ?? '—'} · ${r.report ? t('emr.rad.reported') : t('emr.rad.noReport')}`}
                  onOpen={() => open('radiology', { norawat: nr, item: r.id })}
                  openLabel={t('emr.open.radViewer')}
                />,
              ),
            );
          m.prescription?.forEach((p) =>
            rows.push(
              <SummaryRow
                key={p.no_resep}
                icon="pill"
                label={t('emr.seg.prescription')}
                count={p.items.length + p.compounds.length}
                preview={[
                  ...p.items.map((it) => `${it.drug_name ?? '—'} (${it.aturan_pakai})`),
                  ...p.compounds.map((c) => `${c.nama_racik} (${c.aturan_pakai})`),
                ].join('; ')}
                onOpen={() => open('prescription', { norawat: nr, item: p.no_resep })}
                openLabel={t('emr.open.rxViewer')}
              />,
            ),
          );
          if (m.medication_given?.length)
            rows.push(
              <SummaryRow
                key="given"
                icon="syringe"
                label={t('emr.seg.medGiven')}
                count={m.medication_given.length}
                preview={m.medication_given
                  .map((g) => `${g.drug_name ?? '—'} × ${g.jml}`)
                  .join('; ')}
                onOpen={() => open('emr-diagnostics', { norawat: nr })}
                openLabel={t('emr.open.diagnostics')}
              />,
            );
          m.procedures?.forEach((p, i) =>
            rows.push(
              <SummaryRow
                key={`act${i}`}
                icon="clipboardCheck"
                label={t('emr.seg.action')}
                preview={[p.procedure_name, p.doctor_name ?? p.staff_name]
                  .filter(Boolean)
                  .join(' · ')}
              />,
            ),
          );
          m.surgery?.forEach((s, i) =>
            rows.push(
              <SummaryRow
                key={`op${i}`}
                icon="scissors"
                label={t('emr.seg.surgery')}
                preview={s.surgery_name ?? '—'}
                onOpen={() => open('emr-encounter', { norawat: nr })}
                openLabel={t('emr.open.encounter')}
              />,
            ),
          );
          return rows;
        };

        const sections = [
          { id: 'stay', label: t('emr.w2.stay') },
          ...(bpjs ? [{ id: 'sep', label: t('emr.sep.title') }] : []),
          { id: 'timeline', label: t('emr.w2.timeline'), count: all.length },
          { id: 'diagnoses', label: t('emr.dx.title'), count: dx.length },
          { id: 'procedures', label: t('emr.px.title'), count: px.length },
          ...(showDischarge ? [{ id: 'discharge', label: t('emr.discharge.title') }] : []),
          ...(claimable ? [{ id: 'claim', label: t('emr.claim.title') }] : []),
        ];

        return (
          <WindowPage
            label={`${t('emr.w2.title')} · ${nr}`}
            identity={<IdentityStrip person={person} facts={facts} />}
            sections={sections}
            toolbar={
              <>
                <OpenWindow
                  icon="stethoscope"
                  label={t('emr.w3.short')}
                  onClick={() => open('emr-encounter', { norawat: nr })}
                />
                <OpenWindow
                  icon="flask"
                  label={t('emr.w4.short')}
                  onClick={() => open('emr-diagnostics', { norawat: nr })}
                />
                <OpenWindow
                  icon="receipt"
                  label={t('emr.viewer.billing.short')}
                  onClick={() => open('billing', { norawat: nr, item: 'summary' })}
                />
                <AskAi tag={tag} />
              </>
            }
          >
            <Section id="stay" title={t('emr.w2.stay')} icon="bed">
              <FieldList>
                <FieldRow
                  label={t('emr.stay.admitted')}
                  value={<StoredTime value={facts.admittedKey} absent="—" />}
                />
                <FieldRow
                  label={t('emr.stay.discharged')}
                  // Only a missing discharge means "still admitted"; an unreadable one is a data problem, not a stay.
                  value={
                    <StoredTime value={facts.discharged} absent={t('emr.stay.stillAdmitted')} />
                  }
                />
                <FieldRow
                  label={t('emr.stay.los')}
                  value={
                    facts.lengthOfStay !== null
                      ? t('emr.stay.days', { n: facts.lengthOfStay })
                      : undefined
                  }
                />
                <FieldRow
                  label={t('emr.stay.ward')}
                  value={
                    [facts.ward, facts.roomClass].filter(Boolean).join(' · ') ||
                    facts.department ||
                    undefined
                  }
                />
                <FieldRow
                  label={t('emr.stay.dischargeStatus')}
                  value={facts.dischargeStatus ?? undefined}
                />
                <FieldRow label={t('emr.stay.status')} value={facts.status ?? undefined} />
              </FieldList>
            </Section>

            {bpjs && (
              <Section id="sep" title={t('emr.sep.title')} icon="shield">
                <SepDetails sep={facts.sep} />
              </Section>
            )}

            <Section id="timeline" title={t('emr.w2.timeline')} icon="route" count={all.length}>
              <ol className={w.timeline}>
                {all.map(({ key, moment }) => {
                  const rows = rowsFor(key, moment);
                  if (rows.length === 0) return null;
                  return (
                    <li key={key} className={w.moment}>
                      <h3 className={w.momentHead}>
                        <StoredTime value={key} absent={t('emr.undated')} />
                      </h3>
                      <RowList>{rows}</RowList>
                    </li>
                  );
                })}
              </ol>
            </Section>

            <Section
              id="diagnoses"
              title={t('emr.dx.title')}
              icon="stethoscope"
              count={dx.length}
              actions={
                <>
                  <EditAction label={t('emr.edit.addDx')} icon="plus" />
                  <AskAi
                    tag={{ ...tag, id: `enc:${nr}:dx`, kind: 'section', section: 'diagnoses' }}
                  />
                </>
              }
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
                    {
                      key: 'n',
                      header: t('emr.dx.name'),
                      render: (d) => d.diagnosis_name ?? '—',
                    },
                    {
                      key: 's',
                      header: t('emr.dx.case'),
                      render: (d) =>
                        d.status_penyakit
                          ? t(`emr.dx.case.${d.status_penyakit === 'Baru' ? 'new' : 'old'}`)
                          : '—',
                    },
                  ]}
                />
              )}
            </Section>

            <Section
              id="procedures"
              title={t('emr.px.title')}
              icon="clipboardCheck"
              count={px.length}
            >
              {px.length === 0 ? (
                <NotAvailable reason="recorded" />
              ) : (
                <DataTable
                  caption={t('emr.px.title')}
                  rows={px}
                  rowKey={(p) => `${p.kode}-${p.prioritas}`}
                  columns={[
                    {
                      key: 'c',
                      header: t('emr.px.icd9'),
                      render: (p) => <span className={w.code}>{p.kode}</span>,
                    },
                    {
                      key: 'n',
                      header: t('emr.px.name'),
                      render: (p) => p.procedure_name ?? '—',
                    },
                  ]}
                />
              )}
              <p className={w.note}>{t('emr.px.billedNote')}</p>
            </Section>

            {showDischarge && (
              <Section id="discharge" title={t('emr.discharge.title')} icon="file">
                {!ds ? (
                  <NotAvailable reason="recorded" />
                ) : (
                  <>
                    <p className={w.note}>
                      {t('emr.discharge.author', { name: ds.doctor_name ?? '—' })}
                    </p>
                    {/* Allergy as written in the discharge summary; empty = not recorded, never "no known allergies". */}
                    <TextBlock
                      label={t('emr.discharge.allergy')}
                      text={
                        ds.alergi.trim() ? (
                          <strong className="inline-flex items-start gap-6 text-danger-fg">
                            <Icon name="alert" size={16} className="mt-2 flex-none" />
                            <span className="whitespace-pre-line">{ds.alergi.trim()}</span>
                          </strong>
                        ) : null
                      }
                    />
                    <TextBlock label={t('emr.discharge.complaint')} text={ds.keluhan_utama} />
                    <TextBlock label={t('emr.discharge.course')} text={ds.jalannya_penyakit} />
                    <TextBlock
                      label={t('emr.discharge.primaryDx')}
                      text={`${ds.kd_diagnosa_utama} ${ds.diagnosa_utama}`}
                    />
                    <TextBlock
                      label={t('emr.discharge.secondaryDx')}
                      text={`${ds.kd_diagnosa_sekunder} ${ds.diagnosa_sekunder}`.trim()}
                    />
                    <TextBlock
                      label={t('emr.discharge.procedure')}
                      text={`${ds.kd_prosedur_utama} ${ds.prosedur_utama}`.trim()}
                    />
                    <TextBlock label={t('emr.discharge.condition')} text={ds.keadaan} />
                    <TextBlock label={t('emr.discharge.leaving')} text={ds.cara_keluar} />
                    <TextBlock label={t('emr.discharge.meds')} text={ds.obat_pulang} />
                    <TextBlock label={t('emr.discharge.diet')} text={ds.diet} />
                    <TextBlock label={t('emr.discharge.education')} text={ds.edukasi} />
                    <TextBlock
                      label={t('emr.discharge.control')}
                      text={formatStored(ds.kontrol, locale) ?? ds.kontrol}
                    />
                    <p className={w.note}>{t('emr.discharge.signNA')}</p>
                  </>
                )}
              </Section>
            )}

            {claimable && (
              <Section
                id="claim"
                title={t('emr.claim.title')}
                icon="shield"
                actions={
                  <AskAi
                    tag={{ ...tag, id: `enc:${nr}:claim`, kind: 'section', section: 'claim' }}
                    label={t('emr.ai.askClaim')}
                  />
                }
              >
                <ClaimChecks claim={claim} allowed={claimAllowed} />
              </Section>
            )}
          </WindowPage>
        );
      }}
    </EncounterGate>
  );
}
