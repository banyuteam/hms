import type { ReactNode } from 'react';
import { Navigate } from 'react-router';
import { useAuthStore } from './authStore';

export function RequireAuth({ children }: { children: ReactNode }) {
  const user = useAuthStore((s) => s.user);
  return user ? <>{children}</> : <Navigate to="/login" replace />;
}
