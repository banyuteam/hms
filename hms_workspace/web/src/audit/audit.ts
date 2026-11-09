import { isLiveApi } from '@/api/liveApi';
import type { AuditSubject } from './subject';

/**
 * UI audit events (Permenkes 24/2022: every read of a medical record emits an audit event — who, what, when, why).
 * Data reads are recorded by hms_services itself; the UI reports what only it knows (a masked value revealed), with a
 * correlation id. Events hold NO values: only the action, a field key and the record's identifiers. With live data they
 * must reach the hms_services audit trail (`reportAudit`); the in-memory list below is kept for the demo and is wiped on
 * sign-out.
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

/** Called on logout / idle lock. */
export function clearAudit(): void {
  events.length = 0;
}

/**
 * Reports an event and resolves `true` once it is recorded. With live data it must be stored in the hms_services audit
 * trail — `false` means it was not, and the caller must not show what was asked for. hms_services has no UI audit
 * endpoint yet (planned with the first clinical slice), so live reveals are refused: fail closed. With synthetic data the
 * event is kept in memory and always succeeds.
 */
export async function reportAudit(
  action: AuditAction,
  subject: string,
  // Kept for the endpoint to come: the record identifiers the event will carry.
  _record: AuditSubject = {},
): Promise<boolean> {
  emitAudit(action, subject);
  return !isLiveApi();
}
