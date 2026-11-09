import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach, beforeEach, vi } from 'vitest';
import { resourceCache } from '@/lib/resource';

afterEach(() => {
  cleanup();
  resourceCache.clear();
  vi.unstubAllEnvs();
});

// The synthetic adapters answer immediately in tests (the app default simulates ~150 ms).
beforeEach(() => {
  vi.stubEnv('VITE_MOCK_LATENCY_MS', '0');
});

// Node-environment tests (vite-plugins/*) have no DOM: skip the browser stubs there.
if (typeof window !== 'undefined') {
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
  window.HTMLElement.prototype.scrollIntoView ??= function scrollIntoView() {};

  // jsdom has no layout: give elements a desktop-sized box so the window manager has a work area.
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', {
    configurable: true,
    get: () => 1440,
  });
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', {
    configurable: true,
    get: () => 780,
  });
}
