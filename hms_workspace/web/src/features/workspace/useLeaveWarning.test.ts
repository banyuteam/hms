import { renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { useLeaveWarning } from './useLeaveWarning';

const unload = () => {
  const e = new Event('beforeunload', { cancelable: true });
  window.dispatchEvent(e);
  return e.defaultPrevented;
};

describe('useLeaveWarning', () => {
  it('asks before a reload or tab close only while windows are open', () => {
    const { rerender, unmount } = renderHook(({ on }) => useLeaveWarning(on), {
      initialProps: { on: false },
    });
    expect(unload()).toBe(false);
    rerender({ on: true });
    expect(unload()).toBe(true);
    rerender({ on: false });
    expect(unload()).toBe(false);
    rerender({ on: true });
    unmount(); // signed out: the workspace is gone, nothing is held back
    expect(unload()).toBe(false);
  });
});
