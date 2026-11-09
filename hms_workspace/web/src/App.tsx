import { useEffect, useState, type ReactNode } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AppProviders } from '@/AppProviders';
import { isLiveApi } from '@/api/liveApi';
import { fetchSession } from '@/auth/authApi';
import { useI18n } from '@/locales/I18nProvider';
import { LoginPage } from '@/pages/LoginPage';
import { WorkspacePage } from '@/pages/WorkspacePage';
import { useAuth, useAuthActions } from '@/state/auth';

/** Client-side guard for the DEMO session only. Not authorization: the API authorizes every request. */
function RequireAuth({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  return user ? <>{children}</> : <Navigate to="/login" replace />;
}

/**
 * Live data: a page reload keeps the hms_services session cookie but loses the in-memory app state, so the session is asked
 * for once before any route renders (otherwise the guard would bounce to /login and lose the workflow route). A server that
 * cannot be reached is never treated as signed in: the login page shows and sign-in reports the problem.
 */
function SessionRestore({ children }: { children: ReactNode }) {
  const { t } = useI18n();
  const { user } = useAuth();
  const { loginLive } = useAuthActions();
  const [checking, setChecking] = useState(() => isLiveApi() && !user);
  useEffect(() => {
    if (!checking) return undefined;
    let cancelled = false;
    void fetchSession().then((s) => {
      if (cancelled) return;
      if (s && s !== 'unavailable') loginLive(s);
      setChecking(false);
    });
    return () => {
      cancelled = true;
    };
  }, [checking, loginLive]);
  if (checking) {
    return (
      <p role="status" className="type-body m-0 grid min-h-full place-items-center text-ink-muted">
        {t('login.checking')}
      </p>
    );
  }
  return <>{children}</>;
}

/**
 * Top-level routes only (CLAUDE.md §3): `/` Home, `/{workflow}` a workflow module window. Windows are in-memory state, not
 * routes; no patient identifier ever appears in a URL. Unknown workflows render the not-found screen inside WorkspacePage.
 */
export function AppRoutes() {
  return (
    <SessionRestore>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route
          path="/:workflow?"
          element={
            <RequireAuth>
              <WorkspacePage />
            </RequireAuth>
          }
        />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </SessionRestore>
  );
}

export function App() {
  return (
    <AppProviders>
      <BrowserRouter>
        <AppRoutes />
      </BrowserRouter>
    </AppProviders>
  );
}
