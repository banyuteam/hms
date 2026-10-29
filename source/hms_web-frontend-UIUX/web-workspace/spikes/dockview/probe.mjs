// ADR-0003 D1 spike probe — run: node probe.mjs (needs `pnpm exec vite preview --port 5199` running).
import { chromium } from '/Users/erfanhuda/Documents/Shared Projects/hms/source/hms_web-frontend-UIUX/web-workspace/node_modules/@playwright/test/index.mjs';
const out = {};
const browser = await chromium.launch({ channel: 'chrome' });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.goto('http://127.0.0.1:5199/');
await page.waitForFunction(() => window.__api && window.__api.panels.length === 3);

// 1. a11y semantics
out.semantics = await page.evaluate(() => {
  const attrs = (el) => Object.fromEntries([...el.attributes].filter((a) => /^(role|tabindex|aria-|draggable)/.test(a.name)).map((a) => [a.name, a.value]));
  const sample = (sel) => [...document.querySelectorAll(sel)].slice(0, 3).map((e) => ({ tag: e.tagName, cls: e.className.toString().slice(0, 40), ...attrs(e) }));
  return {
    tabs: sample('.dv-tab'), tablist: sample('.dv-tabs-container'), groups: sample('.dv-groupview'),
    floating: sample('.dv-resize-container'), headerActions: sample('.dv-right-actions-container, .dv-tabs-and-actions-container'),
    anyRoleTab: document.querySelectorAll('[role=tab]').length, anyRoleTabpanel: document.querySelectorAll('[role=tabpanel]').length,
    anyRoleDialog: document.querySelectorAll('[role=dialog]').length, ariaLabelled: document.querySelectorAll('[aria-label],[aria-labelledby]').length,
  };
});

// 2. keyboard: tab order + can a floating group be moved/resized/closed by keyboard?
const seq = [];
for (let i = 0; i < 12; i++) {
  await page.keyboard.press('Tab');
  seq.push(await page.evaluate(() => { const a = document.activeElement; return a === document.body ? 'body' : `${a.tagName}.${a.className.toString().split(' ')[0]}|${(a.textContent||'').trim().slice(0,18)}`; }));
}
out.tabOrder = seq;
const fbox = async () => page.evaluate(() => { const e = document.querySelector('.dv-resize-container'); if (!e) return { floatingGroups: 0 }; const r = e.getBoundingClientRect(); return [r.x, r.y, r.width, r.height].map(Math.round); });
const before = await fbox();
await page.locator('.dv-resize-container .dv-tab').first().focus().catch(() => {});
for (const k of ['ArrowRight', 'ArrowRight', 'Shift+ArrowRight', 'ArrowDown']) await page.keyboard.press(k);
const afterKb = await fbox();
out.keyboardMoveFloating = { before, afterKb, moved: JSON.stringify(before) !== JSON.stringify(afterKb) };

// pointer drag of the floating group (baseline: does it work)
const hdr = await page.locator('.dv-floating-titlebar').first().boundingBox();
await page.mouse.move(hdr.x + hdr.width - 60, hdr.y + 10); await page.mouse.down(); await page.mouse.move(hdr.x + hdr.width + 40, hdr.y + 70, { steps: 6 }); await page.mouse.up();
out.pointerDragFloating = { before: afterKb, after: await fbox(), groupsAfter: await page.evaluate(() => ({ total: window.__api.groups.length, floating: [...window.__api.groups].filter((g) => g.model.location.type === 'floating').length })) };

// 3. serialisation / PHI
const json = await page.evaluate(() => window.__api.toJSON());
const s = JSON.stringify(json);
out.serialise = { bytes: s.length, containsTitleWithRM: s.includes('RM 000123'), containsAnyTitle: s.includes('Manajemen Pasien'), panelKeys: Object.keys(json.panels['rm-synthetic'] ?? {}), sample: json.panels['rm-synthetic'] };

// 4. tile layouts (programmatic)
out.tile = await page.evaluate(() => {
  const api = window.__api;
  api.addPanel({ id: 'billing', component: 'p', title: 'Billing', position: { referencePanel: 'patients', direction: 'right' } });
  api.addPanel({ id: 'rad', component: 'p', title: 'Radiologi', position: { referencePanel: 'patients', direction: 'below' } });
  const r = (id) => { const b = api.getPanel(id).group.element.getBoundingClientRect(); return [b.x, b.y, b.width, b.height].map(Math.round); };
  return { groups: api.groups.length, patients: r('patients'), billing: r('billing'), rad: r('rad') };
});

// 5. window ops available in API (min/max/restore/close/dock)
out.api = await page.evaluate(() => {
  const g = window.__api.getPanel('lab').group;
  return { groupApi: Object.keys(Object.getPrototypeOf(g.api)).concat(Object.keys(g.api)).filter((k) => /max|min|float|close|popout|lock|visible/i.test(k)).sort(),
           dockviewApi: Object.getOwnPropertyNames(Object.getPrototypeOf(window.__api)).filter((k) => /max|min|float|popout|toJSON|fromJSON|layout/i.test(k)).sort() };
});

// 6. tokens/styling: how many themeable vars
out.styling = await page.evaluate(() => {
  const cs = getComputedStyle(document.querySelector('.dockview-theme-hms'));
  const vars = [...document.styleSheets].flatMap((s) => { try { return [...s.cssRules]; } catch { return []; } }).flatMap((r) => (r.cssText.match(/--dv-[a-z0-9-]+/g) ?? []));
  return { distinctDvVars: [...new Set(vars)].length, bgFromOurTheme: cs.getPropertyValue('--dv-background-color').trim() };
});
await browser.close();
console.log(JSON.stringify(out, null, 1));
