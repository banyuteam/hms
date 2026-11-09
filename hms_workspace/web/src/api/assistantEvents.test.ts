import { afterEach, describe, expect, it, vi } from 'vitest';
import { recordAssistantEvent, resetAssistantEvents } from './assistantEvents';

afterEach(() => {
  vi.restoreAllMocks();
  resetAssistantEvents();
});

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function sentEvents(fetch: { mock: { calls: [unknown, RequestInit?][] } }) {
  return fetch.mock.calls.map(
    ([, init]) =>
      (JSON.parse((init as RequestInit).body as string) as { events: unknown[] }).events[0],
  ) as Record<string, unknown>[];
}

describe('assistant interaction events', () => {
  it('demo data sends nothing', () => {
    const fetch = vi.spyOn(globalThis, 'fetch');
    recordAssistantEvent({ type: 'topic_selected', topic: 'labs', input: 'button' });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('live: one schema-1 event per request, no text or identifiers, one panel session until sign-out', () => {
    vi.stubEnv('VITE_DATA_SOURCE', 'bff');
    const fetch = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(null, { status: 202 }));
    recordAssistantEvent({ type: 'topic_selected', topic: 'claim', input: 'typed' });
    recordAssistantEvent({ type: 'fallback_shown', fallback_kind: 'choose_visit' });
    resetAssistantEvents();
    recordAssistantEvent({ type: 'fallback_shown', fallback_kind: 'help' });

    expect(fetch).toHaveBeenCalledTimes(3);
    const [url, init] = fetch.mock.calls[0]!;
    expect(url).toBe('/api/v1/assistant/events');
    expect(init).toMatchObject({ method: 'POST', credentials: 'same-origin', keepalive: true });
    const [a, b, c] = sentEvents(fetch);
    expect(Object.keys(a!).sort()).toEqual(
      ['client_at', 'event_id', 'input', 'panel_session', 'schema_version', 'topic', 'type'].sort(),
    );
    expect(a).toMatchObject({
      schema_version: 1,
      type: 'topic_selected',
      topic: 'claim',
      input: 'typed',
    });
    expect(a!.event_id).toMatch(UUID);
    expect(a!.event_id).not.toBe(b!.event_id);
    expect(a!.panel_session).toMatch(UUID);
    expect(b!.panel_session).toBe(a!.panel_session);
    expect(c!.panel_session).not.toBe(a!.panel_session);
  });

  it('a failed request is ignored: no error, no retry', async () => {
    vi.stubEnv('VITE_DATA_SOURCE', 'bff');
    const fetch = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('offline'));
    expect(() =>
      recordAssistantEvent({ type: 'fallback_shown', fallback_kind: 'need_tag' }),
    ).not.toThrow();
    await Promise.resolve();
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
