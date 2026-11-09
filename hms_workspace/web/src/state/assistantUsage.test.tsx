import { act, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { recordAssistantEvent, resetAssistantEvents } from '@/api/assistantEvents';
import { AssistantProvider, useAssistantActions } from './assistant';

vi.mock('@/api/assistantEvents', () => ({
  recordAssistantEvent: vi.fn(),
  resetAssistantEvents: vi.fn(),
}));

afterEach(() => vi.clearAllMocks());

const wrapper = ({ children }: { children: ReactNode }) => (
  <AssistantProvider>{children}</AssistantProvider>
);
const recorded = () => vi.mocked(recordAssistantEvent).mock.calls.map(([e]) => e);

describe('assistant usage events', () => {
  it('a topic button records the topic, and the fallback when nothing is tagged', () => {
    const { result } = renderHook(() => useAssistantActions(), { wrapper });
    act(() => result.current.ask('labs'));
    expect(recorded()).toEqual([
      { type: 'topic_selected', topic: 'labs', input: 'button' },
      { type: 'fallback_shown', fallback_kind: 'need_tag' },
    ]);
  });

  it('typed text records a fallback, or the topic it was answered with', () => {
    const { result } = renderHook(() => useAssistantActions(), { wrapper });
    act(() => result.current.send('hello'));
    act(() => result.current.send('what dose should I give?'));
    act(() => result.current.tag({ id: 'enc:x', kind: 'encounter', norawat: 'x' }));
    act(() => result.current.send('is the claim ready?'));
    expect(recorded()).toEqual([
      { type: 'fallback_shown', fallback_kind: 'help' },
      { type: 'fallback_shown', fallback_kind: 'refused' },
      { type: 'topic_selected', topic: 'claim', input: 'typed' },
    ]);
    // Never the typed text.
    expect(JSON.stringify(recorded())).not.toMatch(/dose|claim ready|hello/);
  });

  it('sign-out starts a new panel session', () => {
    const { result } = renderHook(() => useAssistantActions(), { wrapper });
    act(() => result.current.reset());
    expect(resetAssistantEvents).toHaveBeenCalledTimes(1);
  });
});
