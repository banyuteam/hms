import { expect, test, type Page } from '@playwright/test';

async function signIn(page: Page) {
  await page.goto('/');
  await page.getByLabel('Username', { exact: true }).fill('demo.dokter');
  await page.getByLabel('Password', { exact: true }).fill('Demo#2026');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/workspace$/);
}

test.use({ viewport: { width: 1440, height: 900 } });

test('Phase 2: patient detail (tabs, More, profile pages, masking) without PHI in URL or storage', async ({
  page,
}) => {
  await signIn(page);
  await page.getByRole('button', { name: /Patient Management/ }).click();
  const list = page.getByRole('dialog', { name: 'Patient Management' });
  await list.getByRole('row', { name: /Siti Nurhaliza/ }).dblclick();

  const win = page.getByRole('dialog', { name: 'Patient Detail - 00012346' });
  await expect(win.getByRole('heading', { level: 2, name: 'Siti Nurhaliza' })).toBeVisible();
  await expect(win.getByText('Allergy: Penisilin (ruam)')).toBeVisible();

  // design: 1180 px wide window; 8 tabs + More
  const box = (await win.boundingBox())!;
  expect(Math.round(box.width)).toBe(1180);
  await expect(win.getByRole('tab')).toHaveCount(8);
  await win.getByRole('button', { name: 'More' }).click();
  await page.getByRole('menuitem', { name: 'Documents' }).click();
  await expect(win.getByText(/arrives in Phase 3/)).toBeVisible();

  // one active place: a profile page deactivates the tabs
  await win
    .getByRole('navigation', { name: 'Patient profile' })
    .getByRole('button', { name: 'Personal Information' })
    .click();
  await expect(win.getByRole('tab', { selected: true })).toHaveCount(0);
  await expect(win.getByText('3273••••••••0002').first()).toBeVisible();
  await win.getByRole('button', { name: 'Reveal NIK' }).click();
  await expect(win.getByText('3273010210850002')).toBeVisible();

  // Medical Record
  await win.getByRole('tab', { name: 'Medical Record' }).click();
  await expect(win.getByText('J18.9')).toBeVisible();
  await expect(win.getByText('Penisilin').first()).toBeVisible();

  // no PHI in the URL or in browser storage
  expect(page.url()).not.toMatch(/00012346|Siti/);
  expect(await page.evaluate(() => Object.keys(window.localStorage))).toEqual([]);
  expect(await page.evaluate(() => Object.keys(window.sessionStorage))).toEqual([]);
});

test('Phase 2: tile layout geometry, floating windows on top, and the compact shell', async ({
  page,
}) => {
  await signIn(page);
  // the first window covers the home tiles, so open modules from the launcher in the top bar
  for (const name of [/Patient Management/, /Laboratory Results/, /Radiology Viewer/]) {
    await page.getByRole('button', { name: 'Module launcher' }).click();
    await page.getByRole('menuitem', { name }).click();
  }
  await page.getByRole('button', { name: 'Window layout' }).click();
  await page.getByRole('menuitemradio', { name: /One \+ two/ }).click();

  const rect = async (title: string) =>
    (await page.getByRole('dialog', { name: title }).boundingBox())!;
  // Mockup 05: big tile 752×748 at (24,80); the other two 624×366 at x=792
  const big = await rect('Radiology Viewer');
  expect([
    Math.round(big.x),
    Math.round(big.y),
    Math.round(big.width),
    Math.round(big.height),
  ]).toEqual([24, 80, 752, 748]);
  const right = await rect('Laboratory Results');
  expect([Math.round(right.x), Math.round(right.width), Math.round(right.height)]).toEqual([
    792, 624, 366,
  ]);

  // a 4th window floats above the tiles
  await page.getByRole('button', { name: 'Module launcher' }).click();
  await page.getByRole('menuitem', { name: /Billing & Insurance/ }).click();
  const z = async (title: string) =>
    Number(
      await page
        .getByRole('dialog', { name: title })
        .evaluate((el) => (el as HTMLElement).style.zIndex),
    );
  expect(await z('Billing & Insurance')).toBeGreaterThan(await z('Radiology Viewer'));

  // shrink below what the preset needs → tiling pauses, one window shows
  await page.getByRole('button', { name: 'Window layout' }).click();
  await page.getByRole('menuitemradio', { name: /Four windows/ }).click();
  await page.setViewportSize({ width: 760, height: 560 });
  await expect(page.getByRole('status')).toContainText('Layout paused');
  await expect(page.getByRole('dialog')).toHaveCount(1);
  await page.setViewportSize({ width: 1440, height: 900 });
  await expect(page.getByRole('dialog')).toHaveCount(4);
});
