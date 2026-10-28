import { BrowserRouter, Navigate, Route, Routes } from 'react-router';
import { RequireAuth } from '@/auth/RequireAuth';
import { AppProviders } from '@/AppProviders';
import { LoginPage } from '@/pages/LoginPage';
import { Workspace } from '@/workspace/Workspace';

/** Top-level routes only (ADR-0003 D6): windows are not routes and no patient ids ever appear in URLs. */
export function AppRoutes() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route
        path="/workspace"
        element={
          <RequireAuth>
            <Workspace />
          </RequireAuth>
        }
      />
      <Route path="*" element={<Navigate to="/workspace" replace />} />
    </Routes>
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
