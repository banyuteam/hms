import type { Topic } from '@/features/assistant/rules';

/**
 * Assistant interaction events (assistant-v1 1.1.0 `POST /assistant/events`, ADR-SVC-008 Decision 6, schema v1): which
 * topic was asked and how, and when the assistant asked back instead of answering. No text, tags, visit or patient
 * identifiers. Fire-and-forget: one request per event, never retried, never awaited, errors ignored, and nothing is
 * stored in the browser. It does not use `liveSend`, so a failed event can never sign the person out or show an error.
 * Demo data and tests send nothing.
 */
export type FallbackKind =
  | 'help'
  | 'need_tag'
  | 'need_visit'
  | 'choose_visit'
  | 'not_loaded'
  | 'refused';

export type AssistantEvent =
  | { type: 'topic_selected'; topic: Topic; input: 'button' | 'typed' }
  | { type: 'fallback_shown'; fallback_kind: FallbackKind };

/** Random id per panel session (from the first event after sign-in until sign-out); groups events, not an identity. */
let panelSession: string | null = null;

/** Sign-out / idle lock: the next event starts a new panel session. */
export function resetAssistantEvents(): void {
  panelSession = null;
}

export function recordAssistantEvent(e: AssistantEvent): void {
  if (import.meta.env.VITE_DATA_SOURCE !== 'bff') return;
  try {
    panelSession ??= crypto.randomUUID();
    const event = {
      schema_version: 1,
      event_id: crypto.randomUUID(),
      client_at: new Date().toISOString(),
      panel_session: panelSession,
      ...e,
    };
    void fetch('/api/v1/assistant/events', {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({ events: [event] }),
      credentials: 'same-origin',
      cache: 'no-store',
      keepalive: true,
    }).catch(() => undefined);
  } catch {
    // Telemetry never affects the assistant.
  }
}
