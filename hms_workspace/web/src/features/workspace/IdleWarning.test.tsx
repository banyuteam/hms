import { act, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderWorkspace } from './testProbe';

beforeEach(() => {
  vi.stubEnv('VITE_DEMO_AUTH', 'true');
  vi.stubEnv('VITE_IDLE_MINUTES', '2');
  vi.useFakeTimers({ shouldAdvanceTime: false });
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

describe('idle warning (WCAG 2.2.1)', () => {
  it('warns a minute before the idle sign-out; "Stay signed in" keeps the windows', () => {
    const { probe } = renderWorkspace('/');
    act(() => probe.actions.open('emr-records'));
    act(() => {
      vi.advanceTimersByTime(60_000);
    });
    const dialog = screen.getByRole('alertdialog', { name: 'Your session is about to end' });
    expect(dialog).toHaveTextContent('every open window will close');
    expect(dialog).toHaveTextContent('Ends in 60 seconds');
    const stay = screen.getByRole('button', { name: 'Stay signed in' });
    expect(stay).toHaveFocus();
    act(() => stay.click());
    expect(screen.queryByRole('alertdialog')).toBeNull();
    act(() => {
      vi.advanceTimersByTime(100_000);
    });
    expect(probe.state.windows).toHaveLength(1);
    expect(probe.pathname).not.toBe('/login');
  });

  it('without an answer the session ends and the windows are cleared', () => {
    const { probe } = renderWorkspace('/');
    act(() => probe.actions.open('emr-records'));
    act(() => {
      vi.advanceTimersByTime(120_000);
    });
    expect(probe.pathname).toBe('/login');
    expect(probe.state.windows).toHaveLength(0);
  });
});
