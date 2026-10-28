/**
 * Audit event stub (Permenkes 24/2022: every read of a medical record emits an audit event — who, what, when, why).
 * The real event is emitted by the backend; the UI only reports what the user did, with a correlation id.
 * Events here hold NO PHI (no names, no values): only the action, a field key and a timestamp. In-memory only.
 */
export type AuditAction = 'record.open' | 'phi.reveal' | 'record.print';

export interface AuditEvent {
  action: AuditAction;
  /** Field or section key, e.g. "nik" or "medical-record". Never a value. */
  subject: string;
  at: string;
  correlationId: string;
}

const MAX_EVENTS = 200;
const events: AuditEvent[] = [];

export function newCorrelationId(): string {
  return (
    globalThis.crypto?.randomUUID?.() ?? `c-${Date.now()}-${Math.random().toString(16).slice(2)}`
  );
}

export function emitAudit(action: AuditAction, subject: string): AuditEvent {
  const event: AuditEvent = {
    action,
    subject,
    at: new Date().toISOString(),
    correlationId: newCorrelationId(),
  };
  events.push(event);
  if (events.length > MAX_EVENTS) events.shift();
  return event;
}

export function auditEvents(): readonly AuditEvent[] {
  return events;
}

/** Called on logout / idle lock. */
export function clearAudit(): void {
  events.length = 0;
}
