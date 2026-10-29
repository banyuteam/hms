import { useIntl } from 'react-intl';
import { ToggleButton, ToggleButtonGroup } from 'react-aria-components';
import { useLocaleStore } from '@/i18n/localeStore';
import { LOCALES, isLocale } from '@/i18n/locales';
import styles from './LanguageSwitch.module.css';

/** ID | EN segmented control. The choice is saved per browser (`hms.locale`, no PHI). */
export function LanguageSwitch({ glass = false }: { glass?: boolean }) {
  const intl = useIntl();
  const locale = useLocaleStore((s) => s.locale);
  const setLocale = useLocaleStore((s) => s.setLocale);
  return (
    <ToggleButtonGroup
      aria-label={intl.formatMessage({ id: 'lang.label' })}
      selectionMode="single"
      disallowEmptySelection
      selectedKeys={[locale]}
      onSelectionChange={(keys) => {
        const next = [...keys][0];
        if (isLocale(next)) setLocale(next);
      }}
      className={`${styles.group} ${glass ? styles.glass : ''}`}
    >
      {LOCALES.map((l) => (
        <ToggleButton
          key={l}
          id={l}
          aria-label={intl.formatMessage({ id: `lang.switchTo.${l}` })}
          className={styles.item}
        >
          {intl.formatMessage({ id: `lang.${l}` })}
        </ToggleButton>
      ))}
    </ToggleButtonGroup>
  );
}
