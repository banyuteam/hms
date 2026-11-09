import { createContext, useContext, useMemo, type ReactNode } from 'react';

/**
 * Whose record the UI is showing, for audit events (hms_services ADR-SVC-003 §5): a revealed NIK is recorded with the
 * patient it belongs to. Identifiers only (MRN, no_rawat), never values. Set by the windows that show a patient or an
 * encounter; read by `MaskedValue`.
 */
export interface AuditSubject {
  patient?: string;
  encounter?: string;
}

const AuditSubjectContext = createContext<AuditSubject>({});

export function AuditSubjectProvider({
  patient,
  encounter,
  children,
}: AuditSubject & { children: ReactNode }) {
  const value = useMemo(() => ({ patient, encounter }), [patient, encounter]);
  return <AuditSubjectContext.Provider value={value}>{children}</AuditSubjectContext.Provider>;
}

export function useAuditSubject(): AuditSubject {
  return useContext(AuditSubjectContext);
}
