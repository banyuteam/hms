// HMS Desktop bridge client, protocol v1 (contracts/bridge/desktop-bridge-v1.md). Injected by the shell before page
// scripts run. A convenience only: the native side validates every message whatever sends it.
(() => {
  'use strict';
  if (window.top !== window || 'hmsDesktop' in window) return; // main frame only; on Windows wry injects into subframes too
  const PROTOCOL = 1;
  const TIMEOUT_MS = 10000;
  const MAX_PENDING = 32;
  const pending = new Map();
  // Per-document id prefix, so a reply meant for a previous document can never resolve a request in this one.
  const prefix = Array.from(crypto.getRandomValues(new Uint8Array(8)), (b) => b.toString(16).padStart(2, '0')).join('');
  let seq = 0;

  function fail(code) {
    const e = new Error('hmsDesktop: ' + code);
    e.code = code;
    return e;
  }

  function invoke(cmd, args) {
    return new Promise((resolve, reject) => {
      if (typeof cmd !== 'string') return reject(fail('invalid_args'));
      if (pending.size >= MAX_PENDING) return reject(fail('busy'));
      const id = prefix + '-' + (++seq).toString(36);
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(fail('timeout'));
      }, TIMEOUT_MS);
      pending.set(id, { resolve, reject, timer });
      try {
        window.ipc.postMessage(JSON.stringify({ v: PROTOCOL, id, cmd, args: args === undefined ? {} : args }));
      } catch (_) {
        clearTimeout(timer);
        pending.delete(id);
        reject(fail('unavailable'));
      }
    });
  }

  function deliver(reply) {
    const p = reply && pending.get(reply.id);
    if (!p) return;
    pending.delete(reply.id);
    clearTimeout(p.timer);
    if (reply.ok) p.resolve(reply.result);
    else p.reject(fail(reply.error && typeof reply.error.code === 'string' ? reply.error.code : 'internal'));
  }

  Object.defineProperty(window, '__hmsDesktopDeliver', { value: deliver });
  Object.defineProperty(window, 'hmsDesktop', { value: Object.freeze({ protocol: PROTOCOL, invoke }), enumerable: true });
})();
