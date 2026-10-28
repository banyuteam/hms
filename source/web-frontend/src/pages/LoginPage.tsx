import { useState, type FormEvent } from 'react';
import { useIntl } from 'react-intl';
import { Button as AriaButton, Input, Label, TextField } from 'react-aria-components';
import { Navigate, useNavigate } from 'react-router';
import { useAuthStore } from '@/auth/authStore';
import { getDemoAccount, isDemoAuthEnabled } from '@/auth/demoAccount';
import { idleMinutes } from '@/auth/useIdleLogout';
import { Button } from '@/components/Button';
import { Icon } from '@/components/Icon';
import { LanguageSwitch } from '@/components/LanguageSwitch';
import { Logo } from '@/components/Logo';
import styles from './LoginPage.module.css';

type ErrorKey = 'required' | 'invalid' | 'disabled';

/** Figma "09 Login": glass card over the calm wallpaper, static demo account banner, ID | EN switch. */
export function LoginPage() {
  const intl = useIntl();
  const navigate = useNavigate();
  const { user, notice, login } = useAuthStore();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [reveal, setReveal] = useState(false);
  const [error, setError] = useState<ErrorKey | null>(null);
  const demo = getDemoAccount();
  const enabled = isDemoAuthEnabled();

  if (user) return <Navigate to="/workspace" replace />;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const result = login(username, password);
    if (result.ok) {
      setPassword('');
      navigate('/workspace', { replace: true });
    } else {
      setError(result.reason);
      setPassword('');
    }
  };

  const noticeText =
    notice === 'idle'
      ? intl.formatMessage({ id: 'login.notice.idle' }, { minutes: idleMinutes() })
      : notice === 'user'
        ? intl.formatMessage({ id: 'login.notice.loggedOut' })
        : null;

  return (
    <div className={styles.page}>
      <div className={styles.lang}>
        <LanguageSwitch glass />
      </div>
      <main className={styles.card}>
        <header className={styles.header}>
          <Logo size={56} />
          <h1>{intl.formatMessage({ id: 'app.name' })}</h1>
          <p>{intl.formatMessage({ id: 'login.title' })}</p>
        </header>

        {noticeText && (
          <p className={styles.notice} role="status">
            {noticeText}
          </p>
        )}

        {demo ? (
          <div className={styles.demo}>
            <Icon name="alert" size={16} />
            <div>
              <strong>{intl.formatMessage({ id: 'login.demo.title' })}</strong>
              <p>
                {intl.formatMessage(
                  { id: 'login.demo.body' },
                  { username: demo.username, password: demo.password },
                )}
              </p>
            </div>
          </div>
        ) : (
          !enabled && (
            <p className={styles.error} role="alert">
              {intl.formatMessage({ id: 'login.error.disabled' })}
            </p>
          )
        )}

        <form onSubmit={submit} className={styles.form} noValidate>
          <TextField
            className={styles.field}
            value={username}
            onChange={setUsername}
            autoComplete="username"
            isDisabled={!enabled}
          >
            <Label>{intl.formatMessage({ id: 'login.username' })}</Label>
            <Input className={styles.input} autoCapitalize="none" spellCheck={false} />
          </TextField>
          <TextField
            className={styles.field}
            value={password}
            onChange={setPassword}
            autoComplete="current-password"
            type={reveal ? 'text' : 'password'}
            isDisabled={!enabled}
          >
            <Label>{intl.formatMessage({ id: 'login.password' })}</Label>
            <div className={styles.inputRow}>
              <Input className={styles.input} />
              <AriaButton
                type="button"
                className={styles.reveal}
                aria-label={intl.formatMessage({
                  id: reveal ? 'login.password.hide' : 'login.password.show',
                })}
                aria-pressed={reveal}
                onPress={() => setReveal((r) => !r)}
                isDisabled={!enabled}
              >
                <Icon name={reveal ? 'eyeOff' : 'eye'} />
              </AriaButton>
            </div>
          </TextField>
          {error && error !== 'disabled' && (
            <p className={styles.error} role="alert">
              {intl.formatMessage({ id: `login.error.${error}` })}
            </p>
          )}
          <Button type="submit" variant="primary" block isDisabled={!enabled}>
            {intl.formatMessage({ id: 'login.submit' })}
          </Button>
        </form>

        <p className={styles.footnote}>{intl.formatMessage({ id: 'login.footnote' })}</p>
      </main>
      <p className={styles.status}>
        <Icon name="lock" size={16} />
        {intl.formatMessage({ id: 'login.status' })}
      </p>
    </div>
  );
}
