import { useI18n } from '@/locales/I18nProvider';
import { StatusPill } from '@/components/StatusPill';
import { VITAL_KEYS, type NoteRow } from '@/api/select';
import { StoredTime } from '@/components/StoredTime';
import { TextBlock } from './Blocks';

/** Nursing notes in Khanza carry SDKI/SLKI/SIKI text in penilaian/rtl — label it so nobody reads it as ICD-10. */
export function isNursingNotation(text: string | null | undefined): boolean {
  return /\b(SDKI|SLKI|SIKI)\b/.test(text ?? '');
}

/**
 * One CPPT entry (Catatan Perkembangan Pasien Terintegrasi). Fixed S-O-A-P-I-E order, text exactly as stored,
 * instructions (I) highlighted, vitals as a compact row. Verification/co-sign is not in the contract → said so.
 */
export function CpptNote({ note, headingLevel = 3 }: { note: NoteRow; headingLevel?: 3 | 4 }) {
  const { t } = useI18n();
  const H = `h${headingLevel}` as const;
  const vitals = VITAL_KEYS.filter((k) => (note[k] ?? '').trim() !== '');

  return (
    <article
      className="flex flex-col gap-8 rounded-md border border-line-subtle bg-surface p-12"
      aria-label={t('emr.cppt.noteLabel', { author: note.author_name ?? '—' })}
    >
      <header className="flex flex-wrap items-center gap-x-8 gap-y-4">
        <H className="type-heading-sm m-0 text-ink [font-variant-numeric:tabular-nums]">
          <StoredTime value={note.key} absent={t('emr.undated')} />
        </H>
        <span className="type-body-strong text-ink-secondary">
          {note.author_name ?? t('emr.cppt.authorUnknown', { nip: note.nip })}
        </span>
        <StatusPill status="neutral">{t(`emr.care.${note.care_setting}`)}</StatusPill>
        {isNursingNotation(`${note.penilaian} ${note.rtl ?? ''}`) && (
          <StatusPill status="info">{t('emr.cppt.nursingNotation')}</StatusPill>
        )}
        <span className="type-caption ml-auto text-ink-muted">{t('emr.cppt.verificationNA')}</span>
      </header>
      {vitals.length > 0 && (
        <dl
          className="m-0 flex flex-wrap gap-x-16 gap-y-4 rounded-sm bg-surface-subtle px-8 py-6"
          aria-label={t('emr.vitals.title')}
        >
          {vitals.map((k) => (
            <div
              key={k}
              className="type-caption flex gap-4 [&_dd]:m-0 [&_dd]:font-semibold [&_dd]:text-ink [&_dd]:[font-variant-numeric:tabular-nums] [&_dt]:text-ink-muted"
            >
              <dt>{t(`emr.vitals.${k}`)}</dt>
              <dd>{note[k]}</dd>
            </div>
          ))}
          <div className="type-caption flex gap-4 [&_dd]:m-0 [&_dd]:font-semibold [&_dd]:text-ink [&_dd]:[font-variant-numeric:tabular-nums] [&_dt]:text-ink-muted">
            <dt>{t('emr.vitals.kesadaran')}</dt>
            <dd>{note.kesadaran}</dd>
          </div>
        </dl>
      )}
      <div className="flex flex-col gap-6">
        <TextBlock label={t('emr.cppt.s')} text={note.keluhan} />
        <TextBlock label={t('emr.cppt.o')} text={note.pemeriksaan} />
        <TextBlock label={t('emr.cppt.a')} text={note.penilaian} />
        <TextBlock label={t('emr.cppt.p')} text={note.rtl} />
        {note.instruksi.trim() !== '' && (
          <div className="rounded-sm border-l-2 border-accent bg-info-bg px-8 py-6">
            <TextBlock label={t('emr.cppt.i')} text={note.instruksi} />
          </div>
        )}
        {note.evaluasi.trim() !== '' && <TextBlock label={t('emr.cppt.e')} text={note.evaluasi} />}
      </div>
    </article>
  );
}
