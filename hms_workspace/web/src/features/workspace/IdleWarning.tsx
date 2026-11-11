import { useEffect, useId, useRef } from 'react';
import { Button } from '@/components/Button';
import { useModalKeys } from '@/components/useModalKeys';
import { Icon } from '@/components/Icon';
import { useI18n } from '@/locales/I18nProvider';

/**
 * Shown shortly before the idle sign-out (WCAG 2.2.1 Timing Adjustable): says when the session ends and what is lost,
 * and keeps it with one action. Modal: the scrim also covers the open records on an unattended screen. Focus moves to
 * "Stay signed in" and returns to where it was when the person stays.
 */
export function IdleWarning({
  secondsLeft,
  onStay,
  onSignOut,
}: {
  secondsLeft: number;
  onStay: () => void;
  onSignOut: () => void;
}) {
  const { t } = useI18n();
  const titleId = useId();
  const descId = useId();
  const stayRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  // Escape counts as "stay": the person is clearly at the screen.
  useModalKeys(panelRef, onStay);

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    stayRef.current?.focus();
    return () => previous?.focus?.();
  }, []);

  return (
    <div className="fixed inset-0 z-scrim grid place-items-center px-16 before:absolute before:inset-0 before:bg-canvas before:opacity-[var(--hms-wallpaper-scrim)]">
      <div
        ref={panelRef}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descId}
        className="relative flex w-[min(440px,100%)] flex-col gap-16 rounded-lg border border-line bg-surface p-24 shadow-popover"
      >
        <h2 id={titleId} className="type-title-md m-0 flex items-center gap-8 text-ink">
          <Icon name="clock" size={20} />
          {t('idle.title')}
        </h2>
        <p id={descId} className="type-body m-0 text-ink-secondary">
          {t('idle.message')}
        </p>
        {/* The countdown is visible but not a live region: announcing every second would drown out the screen reader. */}
        <p className="type-title-md m-0 text-warning-fg [font-variant-numeric:tabular-nums]">
          {t('idle.countdown', { seconds: secondsLeft })}
        </p>
        <div className="flex flex-wrap justify-end gap-8">
          <Button variant="secondary" onClick={onSignOut}>
            {t('idle.signOut')}
          </Button>
          <Button ref={stayRef} variant="primary" onClick={onStay}>
            {t('idle.stay')}
          </Button>
        </div>
      </div>
    </div>
  );
}
