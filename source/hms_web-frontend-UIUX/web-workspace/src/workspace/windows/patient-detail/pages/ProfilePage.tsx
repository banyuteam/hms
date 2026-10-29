import type { ReactElement } from 'react';
import { useIntl } from 'react-intl';
import type { Address, PatientRecord } from '@/api/types';
import { Card } from '@/components/Card';
import { FieldList, FieldRow } from '@/components/FieldRow';
import { formatDate } from '@/i18n/format';
import { useLocaleStore } from '@/i18n/localeStore';
import { enumLabel } from '../labels';
import type { ProfileId } from '../sections';
import styles from './pages.module.css';

/** The four profile pages (Figma W11–W14 / mockups 10–13). Every field was checked against the Khanza schema (patient-profile-fields.md). */
export function ProfilePage({
  id,
  patient,
}: {
  id: Exclude<ProfileId, 'audit'>;
  patient: PatientRecord;
}) {
  const intl = useIntl();
  const locale = useLocaleStore((s) => s.locale);
  const t = (key: string) => intl.formatMessage({ id: key });
  const date = (iso: string) =>
    formatDate(new Date(iso.length === 10 ? `${iso}T00:00:00+07:00` : iso), locale);
  const enc = patient.currentEncounter;

  const addressRows = (a: Address, keyPrefix: string) => (
    <>
      <FieldRow label={t('field.address')} masked={a.line} fieldKey={`${keyPrefix}-address`} />
      <FieldRow label={t('field.village')} value={a.village} />
      <FieldRow label={t('field.district')} value={a.district} />
      <FieldRow label={t('field.city')} value={a.city} />
      <FieldRow label={t('field.province')} value={a.province} />
    </>
  );

  let cards: { left: ReactElement[]; right: ReactElement[] };
  switch (id) {
    case 'personal':
      cards = {
        left: [
          <Card key="identity" title={t('detail.card.identity')} icon="user">
            <FieldList>
              <FieldRow label={t('field.fullName')} value={patient.name} />
              <FieldRow label={t('field.mrn')} value={patient.mrn} />
              <FieldRow label={t('field.nik')} masked={patient.nik} fieldKey="nik" />
              <FieldRow label={t('field.gender')} value={enumLabel(intl, 'sex', patient.sex)} />
              <FieldRow label={t('field.birthPlace')} value={patient.birthPlace} />
              <FieldRow
                label={t('field.birthDate')}
                value={`${date(patient.birthDate)} (${intl.formatMessage({ id: 'unit.years' }, { n: patient.ageYears })})`}
              />
              <FieldRow
                label={t('field.bloodType')}
                value={enumLabel(intl, 'blood', patient.bloodType)}
              />
              <FieldRow
                label={t('field.maritalStatus')}
                value={enumLabel(intl, 'marital', patient.maritalStatus)}
              />
            </FieldList>
          </Card>,
        ],
        right: [
          <Card key="background" title={t('detail.card.background')} icon="users">
            <FieldList>
              <FieldRow label={t('field.religion')} value={patient.religion} />
              <FieldRow
                label={t('field.education')}
                value={enumLabel(intl, 'education', patient.education)}
              />
              <FieldRow label={t('field.occupation')} value={patient.occupation} />
              <FieldRow label={t('field.ethnicity')} value={patient.ethnicity} />
              <FieldRow label={t('field.language')} value={patient.language} />
              <FieldRow label={t('field.motherName')} value={patient.motherName} />
              <FieldRow
                label={t('field.disability')}
                value={patient.disability ?? t('enum.none')}
              />
            </FieldList>
          </Card>,
          <Card key="registration" title={t('detail.card.registration')} icon="calendar">
            <FieldList>
              <FieldRow label={t('field.firstRegistered')} value={date(patient.firstRegistered)} />
              <FieldRow label={t('field.lastVisit')} value={date(patient.lastVisit)} />
              <FieldRow label={t('field.encounters')} value={patient.encounterCount} />
            </FieldList>
          </Card>,
        ],
      };
      break;
    case 'contact':
      cards = {
        left: [
          <Card key="phone" title={t('detail.card.phoneEmail')} icon="user">
            <FieldList>
              <FieldRow label={t('field.phone')} masked={patient.phone} fieldKey="phone" />
              <FieldRow label={t('field.email')} masked={patient.email} fieldKey="email" />
            </FieldList>
          </Card>,
        ],
        right: [
          <Card key="address" title={t('detail.card.address')} icon="home">
            <FieldList>{addressRows(patient.address, 'patient')}</FieldList>
          </Card>,
        ],
      };
      break;
    case 'guarantor':
      cards = {
        left: [
          <Card key="default" title={t('detail.card.guarantorDefault')} icon="shield">
            <FieldList>
              <FieldRow label={t('field.guarantor')} value={patient.guarantor.name} />
              <FieldRow
                label={t('field.membershipNo')}
                masked={patient.guarantor.membershipNo}
                fieldKey="membership-no"
              />
              <FieldRow label={t('field.employer')} value={patient.guarantor.employer} />
              <FieldRow label={t('field.insurerPhone')} value={patient.guarantor.insurerPhone} />
            </FieldList>
          </Card>,
        ],
        right: [
          <Card key="encounter" title={t('detail.card.thisEncounter')} icon="receipt">
            <FieldList>
              <FieldRow label={t('field.guarantor')} value={enc.guarantor} />
              {enc.sep ? (
                <>
                  <FieldRow label={t('field.sepNo')} masked={enc.sep.no} fieldKey="sep-no" />
                  <FieldRow label={t('field.sepDate')} value={date(enc.sep.date)} />
                  <FieldRow
                    label={t('field.serviceType')}
                    value={enumLabel(intl, 'care', enc.sep.care)}
                  />
                  <FieldRow
                    label={t('field.bpjsClass')}
                    value={intl.formatMessage({ id: 'enum.class' }, { n: enc.sep.careClass })}
                  />
                  <FieldRow
                    label={t('field.referralFrom')}
                    value={enumLabel(intl, 'referral', enc.sep.referralFrom)}
                  />
                  <FieldRow label={t('field.referrer')} value={enc.sep.referrer} />
                  <FieldRow label={t('field.initialDiagnosis')} value={enc.sep.initialDiagnosis} />
                  <FieldRow
                    label={t('field.cob')}
                    value={enumLabel(intl, 'yesNo', enc.sep.cob ? 'yes' : 'no')}
                  />
                </>
              ) : (
                <FieldRow label={t('field.sepNo')} value={t('guarantor.noSep')} />
              )}
            </FieldList>
          </Card>,
        ],
      };
      break;
    case 'family':
      cards = {
        left: [
          <Card key="responsible" title={t('detail.card.responsible')} icon="heart">
            <FieldList>
              <FieldRow label={t('field.name')} value={patient.responsiblePerson.name} />
              <FieldRow
                label={t('field.relationship')}
                value={enumLabel(intl, 'relationship', patient.responsiblePerson.relationship)}
              />
              <FieldRow
                label={t('field.occupation')}
                value={patient.responsiblePerson.occupation}
              />
              {addressRows(patient.responsiblePerson.address, 'responsible')}
            </FieldList>
          </Card>,
        ],
        right: [
          <Card key="encounter" title={t('detail.card.thisEncounter')} icon="clock">
            <FieldList>
              <FieldRow label={t('field.name')} value={enc.responsible.name} />
              <FieldRow
                label={t('field.relationship')}
                value={enumLabel(intl, 'relationship', enc.responsible.relationship)}
              />
              <FieldRow
                label={t('field.address')}
                masked={enc.responsible.address}
                fieldKey="encounter-responsible-address"
              />
            </FieldList>
          </Card>,
        ],
      };
      break;
  }

  return (
    <div className={styles.page}>
      <h2 className={styles.heading}>{t(`detail.profile.${id}`)}</h2>
      <p className={styles.caption}>{t('profile.caption')}</p>
      <div className={styles.columns}>
        <div className={styles.stack}>{cards.left}</div>
        <div className={styles.stack}>{cards.right}</div>
      </div>
    </div>
  );
}
