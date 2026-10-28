import { useIntl } from 'react-intl';
import { useAuthStore } from '@/auth/authStore';
import { Icon } from '@/components/Icon';
import { StatusPill } from '@/components/StatusPill';
import { dayPart, formatLongDate } from '@/i18n/format';
import { useLocaleStore } from '@/i18n/localeStore';
import { MODULES } from './registry';
import { useNow } from './useNow';
import { useWindowStore } from './windowStore';
import styles from './Home.module.css';

/** Figma "01 Beranda": greeting + quick-start tiles. Sits behind the floating windows. */
export function Home() {
  const intl = useIntl();
  const locale = useLocaleStore((s) => s.locale);
  const user = useAuthStore((s) => s.user);
  const open = useWindowStore((s) => s.open);
  const openCount = useWindowStore((s) => s.windows.filter((w) => w.mode !== 'minimized').length);
  const now = useNow(60_000);
  const name = user ? intl.formatMessage({ id: user.nameKey }) : '';

  return (
    <div className={styles.home}>
      <header className={styles.greeting}>
        <h1>{intl.formatMessage({ id: 'home.greeting' }, { part: dayPart(now), name })}</h1>
        <p>
          {intl.formatMessage(
            { id: 'home.subtitle' },
            { date: formatLongDate(now, locale), count: openCount },
          )}
        </p>
      </header>
      <section aria-labelledby="quick-start">
        <h2 id="quick-start" className={styles.overline}>
          {intl.formatMessage({ id: 'home.quickStart' })}
        </h2>
        <ul className={styles.tiles}>
          {MODULES.map((m) => {
            const title = intl.formatMessage({ id: `module.${m.key}.title` });
            return (
              <li key={m.key}>
                <button
                  type="button"
                  className={styles.tile}
                  disabled={!m.window}
                  onClick={() => m.window && open(m.key as Parameters<typeof open>[0])}
                >
                  <span className={styles.tileTop}>
                    <span className={styles.chip} data-soon={!m.window || undefined}>
                      <Icon name={m.icon} />
                    </span>
                    {m.window ? (
                      <span className={styles.shortcut}>
                        {intl.formatMessage({ id: 'module.shortcut' }, { n: m.shortcut })}
                      </span>
                    ) : (
                      <StatusPill>{intl.formatMessage({ id: 'module.soon' })}</StatusPill>
                    )}
                  </span>
                  <strong className={styles.tileTitle}>{title}</strong>
                  <span className={styles.tileDesc}>
                    {intl.formatMessage({ id: `module.${m.key}.desc` })}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </section>
    </div>
  );
}
