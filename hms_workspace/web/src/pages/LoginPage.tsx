import { zodResolver } from '@hookform/resolvers/zod';
import { useId, useState } from 'react';
import { useForm } from 'react-hook-form';
import { Navigate, useNavigate } from 'react-router-dom';
import { getDemoAccount, getDemoAccounts, isDemoAuthEnabled } from '@/auth/demoAccount';
import { idleMinutes } from '@/auth/useIdleLogout';
import { Button } from '@/components/Button';
import { Icon } from '@/components/Icon';
import { LanguageSwitch } from '@/components/LanguageSwitch';
import { Logo } from '@/components/Logo';
import { useI18n } from '@/locales/I18nProvider';
import { useAuth, useAuthActions } from '@/state/auth';
import { LiveLoginForm } from './LiveLoginForm';
import { demoLoginSchema, type DemoLoginValues } from './loginSchemas';
import { loginStyles } from './loginStyles';

/** Figma "09 Login": glass card over the calm wallpaper, static demo account banner, ID | EN switch. */
export function LoginPage() {
  const { t } = useI18n();
  const navigate = useNavigate();
  const { user, notice } = useAuth();
  const { login } = useAuthActions();
  const [reveal, setReveal] = useState(false);
  const [failure, setFailure] = useState<'invalid' | 'required' | null>(null);
  const errorId = useId();
  const demo = getDemoAccount();
  const enabled = isDemoAuthEnabled();
  // Inline (not isLiveApi()) so a demo build folds this to false and drops the live sign-in code entirely.
  const live = import.meta.env.VITE_DATA_SOURCE === 'bff';

  const {
    register,
    handleSubmit,
    setValue,
    formState: { errors },
  } = useForm<DemoLoginValues>({
    resolver: zodResolver(demoLoginSchema),
    defaultValues: { username: '', password: '' },
  });

  if (user) return <Navigate to="/" replace />;

  const onValid = (values: DemoLoginValues) => {
    const result = login(values.username, values.password);
    setValue('password', '');
    if (result.ok) {
      navigate('/', { replace: true });
    } else if (result.reason !== 'disabled') {
      setFailure(result.reason);
    }
  };
  const onInvalid = () => {
    setFailure(null);
    setValue('password', '');
  };

  const fieldError = errors.username?.message ?? errors.password?.message;
  const errorKey = fieldError ?? (failure ? `login.error.${failure}` : null);
  const invalid = Boolean(errorKey);

  const noticeText =
    notice === 'idle'
      ? t('login.notice.idle', { minutes: idleMinutes() })
      : notice === 'user'
        ? t('login.notice.loggedOut')
        : notice === 'expired'
          ? t('login.notice.expired')
          : null;

  return (
    <div className="relative grid min-h-full place-items-center bg-wallpaper px-16 py-48 before:absolute before:inset-0 before:bg-canvas before:opacity-[var(--hms-focus-scrim)]">
      {/* Landmarks for everything outside the card: banner (language) and contentinfo (status). */}
      <header className="absolute right-32 top-32 z-1">
        <LanguageSwitch glass />
      </header>
      <main className="relative z-1 flex w-[min(440px,100%)] flex-col gap-20 rounded-lg border border-glass-stroke bg-surface p-32 shadow-window backdrop-blur-[var(--hms-glass-blur)] supports-[backdrop-filter:blur(1px)]:bg-glass">
        <header className="flex flex-col items-center gap-8 text-center">
          <Logo size={56} />
          <h1 className="type-title-lg m-0">{t('app.name')}</h1>
        </header>

        {noticeText && (
          <p
            className="m-0 rounded-md bg-info-bg px-12 py-8 text-[length:var(--hms-text-caption-size)] text-info-fg"
            role="status"
          >
            {noticeText}
          </p>
        )}

        {live ? (
          <LiveLoginForm />
        ) : demo ? (
          <div className={loginStyles.banner}>
            <Icon name="alert" size={16} />
            <div>
              <strong>{t('login.demo.title')}</strong>
              <p>{t('login.demo.body', { username: demo.username, password: demo.password })}</p>
              {getDemoAccounts()
                .filter((a) => a.role === 'employee')
                .map((a) => (
                  <p key={a.username}>
                    {t('login.demo.employee', { username: a.username, password: a.password })}
                  </p>
                ))}
            </div>
          </div>
        ) : (
          !enabled && (
            <p className={loginStyles.errorText} role="alert">
              {t('login.error.disabled')}
            </p>
          )
        )}

        {!live && (
          <form
            onSubmit={(e) => void handleSubmit(onValid, onInvalid)(e)}
            className="flex flex-col gap-16"
            noValidate
          >
            <div className={loginStyles.field}>
              <label htmlFor="login-username">{t('login.username')}</label>
              <input
                id="login-username"
                className={`${loginStyles.input} px-12`}
                autoComplete="username"
                autoCapitalize="none"
                spellCheck={false}
                disabled={!enabled}
                aria-invalid={invalid || undefined}
                aria-describedby={invalid ? errorId : undefined}
                {...register('username', { onChange: () => setFailure(null) })}
              />
            </div>
            <div className={loginStyles.field}>
              <label htmlFor="login-password">{t('login.password')}</label>
              <div className="relative flex">
                <input
                  id="login-password"
                  type={reveal ? 'text' : 'password'}
                  className={`${loginStyles.input} pl-12 pr-[44px]`}
                  autoComplete="current-password"
                  disabled={!enabled}
                  aria-invalid={invalid || undefined}
                  aria-describedby={invalid ? errorId : undefined}
                  {...register('password', { onChange: () => setFailure(null) })}
                />
                <button
                  type="button"
                  className="absolute right-4 top-4 grid size-[32px] cursor-pointer place-items-center rounded-sm border-0 bg-transparent p-0 text-ink-muted focus-visible:focus-ring disabled:cursor-not-allowed"
                  aria-label={t(reveal ? 'login.password.hide' : 'login.password.show')}
                  aria-pressed={reveal}
                  onClick={() => setReveal((r) => !r)}
                  disabled={!enabled}
                >
                  <Icon name={reveal ? 'eyeOff' : 'eye'} />
                </button>
              </div>
            </div>
            {errorKey && (
              <p id={errorId} className={loginStyles.errorText} role="alert">
                {t(errorKey)}
              </p>
            )}
            <Button type="submit" variant="primary" block disabled={!enabled}>
              {t('login.submit')}
            </Button>
          </form>
        )}

        <p className="type-caption m-0 text-ink-muted">
          {t(live ? 'login.footnote' : 'login.footnote.demo')}
        </p>
      </main>
      <footer className="absolute bottom-24 left-1/2 z-1 m-0 flex -translate-x-1/2 items-center gap-8 whitespace-nowrap rounded-full bg-glass px-12 py-8 text-[length:var(--hms-text-caption-size)] text-ink-secondary phone:hidden">
        <Icon name="lock" size={16} />
        {t('login.status')}
      </footer>
    </div>
  );
}
