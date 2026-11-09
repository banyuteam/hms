import { StatusPill } from '@/components/StatusPill';
import { RecordSearch } from '@/features/emr/components/RecordSearch';
import { HOME_CARDS, windowIcon, windowTitle } from '@/features/workspace/windowMeta';
import { useNow } from '@/lib/useNow';
import { dayPart, formatLongDate } from '@/locales/format';
import { useI18n } from '@/locales/I18nProvider';
import { useAssistantActions } from '@/state/assistant';
import { PERMISSIONS } from '@/features/iam/iamApi';
import { TARIFF_PERMISSION } from '@/features/tariffs/tariffApi';
import {
  displayName,
  useAuth,
  useCanEdit,
  usePermission,
  useRole,
  useRoleLabelKey,
} from '@/state/auth';
import { useHome, useHomeActions } from '@/state/home';
import { ModuleCard } from './ModuleCard';

const overline = 'type-overline mt-0 mb-12 text-ink-muted uppercase';

/**
 * Home: search first (name / MRN / no_rawat), four task cards with a role-aware verb, the AI assistant card, and the records
 * already open in this session (from the window state, in memory only — nothing stored).
 */
export function Home() {
  const { t, locale } = useI18n();
  const { user } = useAuth();
  const role = useRole();
  const canEdit = useCanEdit();
  const roleLabel = useRoleLabelKey();
  // UI hint only: hms_services authorizes every IAM request.
  const canAdminister = usePermission(PERMISSIONS.usersRead);
  const canReadTariffs = usePermission(TARIFF_PERMISSION);
  const { windows } = useHome();
  const { open, activate } = useHomeActions();
  const { setMode: setAssistant } = useAssistantActions();
  const now = useNow(60_000);
  const name = user ? displayName(user, t) : '';
  const openRecords = windows.filter((w) => w.params.mrn || w.params.norawat);

  return (
    <div className="@container">
      <div className="mx-auto flex w-[min(var(--hms-size-home-content),100%)] flex-col gap-32 px-24 py-48 cq-compact:gap-24 cq-compact:px-16 cq-compact:py-24">
        <header className="flex items-start justify-between gap-16 cq-compact:flex-col">
          <div>
            <h1 className="type-title-lg mt-0 mb-4">
              {t('home.greeting', { part: dayPart(now), name })}
            </h1>
            <p className="m-0 text-ink-muted">{formatLongDate(now, locale)}</p>
          </div>
          <StatusPill status={role === 'doctor' ? 'info' : 'neutral'}>{t(roleLabel)}</StatusPill>
        </header>

        <section aria-labelledby="home-search" className="flex flex-col">
          <h2 id="home-search" className={overline}>
            {t('emr.home.find')}
          </h2>
          <RecordSearch
            patients
            label={t('emr.search.labelAny')}
            onPick={(pick) =>
              pick.type === 'patient'
                ? open('emr-profile', { mrn: pick.hit.mrn })
                : open('emr-records', { norawat: pick.item.no_rawat })
            }
          />
        </section>

        <section aria-labelledby="home-start">
          <h2 id="home-start" className={overline}>
            {t('emr.home.start')}
          </h2>
          <ul className="m-0 grid list-none grid-cols-[repeat(auto-fill,minmax(var(--hms-size-card-min),1fr))] gap-16 p-0">
            {HOME_CARDS.map((c) => (
              <li key={c.kind}>
                <ModuleCard
                  icon={windowIcon(c.kind)}
                  title={t(`emr.${c.key}.title`)}
                  description={t(`emr.${c.key}.desc`)}
                  shortcut={c.shortcut}
                  verb={t(canEdit ? 'emr.home.verbDoctor' : 'emr.home.verbEmployee')}
                  onOpen={() => open(c.kind)}
                />
              </li>
            ))}
            <li className="col-span-full">
              <ModuleCard
                icon="sparkles"
                tone="ai"
                layout="row"
                title={t('emr.ai.title')}
                description={t('emr.ai.homeDesc')}
                verb={t('emr.ai.openPanel')}
                onOpen={() => setAssistant('docked')}
              />
            </li>
          </ul>
        </section>

        {canReadTariffs && (
          <section aria-labelledby="home-finance">
            <h2 id="home-finance" className={overline}>
              {t('tariff.home.section')}
            </h2>
            <ModuleCard
              icon={windowIcon('tariffs')}
              layout="row"
              title={t('tariff.title')}
              description={t('tariff.home.desc')}
              verb={t('tariff.home.open')}
              onOpen={() => open('tariffs')}
            />
          </section>
        )}

        {canAdminister && (
          <section aria-labelledby="home-admin">
            <h2 id="home-admin" className={overline}>
              {t('iam.home.section')}
            </h2>
            <ModuleCard
              icon={windowIcon('iam-admin')}
              layout="row"
              title={t('iam.title')}
              description={t('iam.home.desc')}
              verb={t('iam.home.open')}
              onOpen={() => open('iam-admin')}
            />
          </section>
        )}

        {openRecords.length > 0 && (
          <section aria-labelledby="home-open">
            <h2 id="home-open" className={overline}>
              {t('emr.home.open')}
            </h2>
            <ul className="m-0 flex list-none flex-wrap gap-8 p-0">
              {openRecords.map((w) => (
                <li key={w.id}>
                  <button
                    type="button"
                    className="type-body cursor-pointer rounded-full border border-line bg-surface px-12 py-6 text-ink-secondary [font-variant-numeric:tabular-nums] hover:bg-selected hover:text-ink-link focus-visible:focus-ring"
                    onClick={() => activate(w.id)}
                  >
                    {windowTitle(t, w)}
                  </button>
                </li>
              ))}
            </ul>
            <p className="type-caption mt-8 mb-0 text-ink-muted">{t('emr.home.openNote')}</p>
          </section>
        )}
      </div>
    </div>
  );
}
