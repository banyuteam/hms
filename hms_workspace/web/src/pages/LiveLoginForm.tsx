import { zodResolver } from '@hookform/resolvers/zod';
import { useId, useState } from 'react';
import { useForm } from 'react-hook-form';
import { useNavigate } from 'react-router-dom';
import { signIn } from '@/auth/authApi';
import { Button } from '@/components/Button';
import { useI18n } from '@/locales/I18nProvider';
import { useAuthActions } from '@/state/auth';
import { liveLoginSchema, type LiveLoginValues } from './loginSchemas';
import { loginStyles } from './loginStyles';

type FailureKey = 'invalid' | 'disabled' | 'rate' | 'unavailable';

/** Message id per failure: user ID / password messages are the Khanza ones, the rest are shared. */
const FAILURE_KEY: Record<FailureKey, string> = {
  invalid: 'login.khanza.error.invalid',
  disabled: 'login.live.error.disabled',
  rate: 'login.khanza.error.rate',
  unavailable: 'login.live.error.unavailable',
};

/**
 * Live sign-in (`VITE_DATA_SOURCE=bff`): the person's own Khanza user ID and password, checked by hms_services
 * (auth-v1, ADR-SVC-001). There is no role choice: an active doctor signs in as the doctor, otherwise an active employee.
 * The server sets the session cookie and authorizes every later request.
 */
export function LiveLoginForm() {
  const { t } = useI18n();
  const navigate = useNavigate();
  const { loginLive } = useAuthActions();
  const [failure, setFailure] = useState<FailureKey | null>(null);
  const errorId = useId();
  const {
    register,
    handleSubmit,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<LiveLoginValues>({
    resolver: zodResolver(liveLoginSchema),
    defaultValues: { username: '', password: '' },
  });

  const onValid = async (values: LiveLoginValues) => {
    setFailure(null);
    const result = await signIn(values.username, values.password);
    setValue('password', '');
    if (result.ok) {
      loginLive(result.session);
      navigate('/', { replace: true });
    } else {
      setFailure(result.reason);
    }
  };

  const errorKey =
    errors.username?.message ?? errors.password?.message ?? (failure ? FAILURE_KEY[failure] : null);
  const invalid = Boolean(errorKey);
  const described = invalid ? errorId : undefined;
  return (
    <form
      onSubmit={(e) => void handleSubmit(onValid, () => setFailure(null))(e)}
      className="flex flex-col gap-16"
      noValidate
    >
      <div className={loginStyles.field}>
        <label htmlFor="live-username">{t('login.khanza.username')}</label>
        <input
          id="live-username"
          className={`${loginStyles.input} px-12`}
          autoComplete="username"
          autoCapitalize="none"
          spellCheck={false}
          disabled={isSubmitting}
          aria-invalid={invalid || undefined}
          aria-describedby={described}
          {...register('username')}
        />
      </div>
      <div className={loginStyles.field}>
        <label htmlFor="live-password">{t('login.password')}</label>
        <input
          id="live-password"
          type="password"
          className={`${loginStyles.input} px-12`}
          autoComplete="current-password"
          disabled={isSubmitting}
          aria-invalid={invalid || undefined}
          aria-describedby={described}
          {...register('password')}
        />
      </div>
      {errorKey && (
        <p id={errorId} className={loginStyles.errorText} role="alert">
          {t(errorKey)}
        </p>
      )}
      <Button type="submit" variant="primary" block disabled={isSubmitting}>
        {t(isSubmitting ? 'login.live.pending' : 'login.submit')}
      </Button>
    </form>
  );
}
