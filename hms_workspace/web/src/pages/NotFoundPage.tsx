import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/Button';
import { Icon } from '@/components/Icon';
import { useI18n } from '@/locales/I18nProvider';

/** Unknown `/{workflow}`: says so plainly and offers the way back to Home. */
export function NotFoundPage() {
  const { t } = useI18n();
  const navigate = useNavigate();
  return (
    <main className="grid h-full place-items-center bg-canvas p-24">
      <section className="flex max-w-[480px] flex-col items-start gap-12 rounded-lg border border-line bg-surface p-24 shadow-window">
        <h1 className="type-title-lg m-0 text-ink">{t('route.notFound.title')}</h1>
        <p className="m-0 text-ink-secondary">{t('route.notFound.body')}</p>
        <Button variant="primary" onClick={() => navigate('/', { replace: true })}>
          <Icon name="home" size={16} />
          {t('route.notFound.home')}
        </Button>
      </section>
    </main>
  );
}
