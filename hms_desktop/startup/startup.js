// Shows the one state named in `?state=` (a fixed set; anything else shows "connecting") and wires the retry button
// to the `startup.retry` bridge command. The shell decides what happens next.
(() => {
  'use strict';
  const STATES = ['connecting', 'unreachable', 'server-error', 'config-missing', 'config-invalid'];

  function show() {
    const requested = new URLSearchParams(location.search).get('state');
    const state = STATES.includes(requested) ? requested : 'connecting';
    for (const section of document.querySelectorAll('section[data-state]')) {
      section.hidden = section.dataset.state !== state;
    }
    const retry = document.querySelector(`section[data-state="${state}"] [data-action="retry"]`);
    if (retry) retry.focus();
  }

  async function onRetry(event) {
    const button = event.currentTarget;
    if (!window.hmsDesktop) return;
    button.disabled = true;
    try {
      await window.hmsDesktop.invoke('startup.retry');
    } catch (_) {
      button.disabled = false; // busy or timed out: let the person try again
    }
  }

  document.addEventListener('DOMContentLoaded', () => {
    for (const b of document.querySelectorAll('[data-action="retry"]')) b.addEventListener('click', onRetry);
    show();
  });
})();
