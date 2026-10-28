import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach, beforeEach, vi } from 'vitest';

import { queryClient } from '@/api/queryClient';

afterEach(() => {
  cleanup();
  queryClient.clear();
  vi.unstubAllEnvs();
  window.localStorage.clear();
});

// The synthetic patient API answers immediately in tests (the app default simulates ~150 ms).
beforeEach(() => {
  vi.stubEnv('VITE_MOCK_LATENCY_MS', '0');
});

// jsdom lacks these browser APIs used by React Aria / the window manager.
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
globalThis.ResizeObserver ??= ResizeObserverStub as unknown as typeof ResizeObserver;
window.matchMedia ??= ((query: string) => ({
  matches: false,
  media: query,
  onchange: null,
  addEventListener() {},
  removeEventListener() {},
  addListener() {},
  removeListener() {},
  dispatchEvent: () => false,
})) as unknown as typeof window.matchMedia;

// jsdom has no layout: give elements a desktop-sized box so the window manager has a work area.
Object.defineProperty(HTMLElement.prototype, 'clientWidth', {
  configurable: true,
  get: () => 1440,
});
Object.defineProperty(HTMLElement.prototype, 'clientHeight', {
  configurable: true,
  get: () => 780,
});
