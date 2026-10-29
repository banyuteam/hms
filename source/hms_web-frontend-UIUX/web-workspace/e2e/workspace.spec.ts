import { expect, test } from '@playwright/test';

test('static demo account: sign in → open window → dock → switch language → sign out', async ({
  page,
}) => {
  await page.goto('/');
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByText('Demo account — for demonstration only')).toBeVisible();

  // wrong password first
  await page.getByLabel('Username', { exact: true }).fill('demo.dokter');
  await page.getByLabel('Password', { exact: true }).fill('salah');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('alert')).toContainText('Incorrect username or password.');

  await page.getByLabel('Username', { exact: true }).fill('demo.dokter');
  await page.getByLabel('Password', { exact: true }).fill('Demo#2026');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/workspace$/);

  // the session is in memory only
  expect(await page.evaluate(() => Object.keys(window.localStorage))).toEqual([]);
  expect(await page.evaluate(() => Object.keys(window.sessionStorage))).toEqual([]);

  await page.getByRole('button', { name: /Patient Management/ }).click();
  const win = page.getByRole('dialog', { name: 'Patient Management' });
  await expect(win).toBeVisible();
  const dock = page.getByRole('navigation', { name: 'Open windows' });
  await expect(
    dock.getByRole('button', { name: 'Patient Management', exact: true }),
  ).toHaveAttribute('aria-current', 'page');

  // drag the window by its title bar
  const bar = win.getByRole('group', { name: 'Patient Management' });
  const before = await win.boundingBox();
  const b = (await bar.boundingBox())!;
  await page.mouse.move(b.x + 200, b.y + 20);
  await page.mouse.down();
  await page.mouse.move(b.x + 170, b.y + 60, { steps: 5 });
  await page.mouse.up();
  const after = await win.boundingBox();
  expect(after!.x).toBeLessThan(before!.x - 20); // the first window is centred, so there is little room to the right

  // minimise → tab stays → restore
  await win.getByRole('button', { name: 'Minimize Patient Management' }).click();
  await expect(win).toBeHidden();
  await dock.getByRole('button', { name: 'Patient Management', exact: true }).click();
  await expect(win).toBeVisible();

  // English is the default; switching to Indonesian is saved per browser
  await page.getByRole('button', { name: /User menu/ }).click();
  await page.getByRole('radio', { name: 'Switch language to Bahasa Indonesia' }).click();
  await page.keyboard.press('Escape'); // close the popover
  await expect(page.getByRole('dialog', { name: 'Manajemen Pasien' })).toBeVisible();
  expect(await page.evaluate(() => window.localStorage.getItem('hms.locale'))).toBe('id');

  // sign out
  await page.getByRole('button', { name: /Menu pengguna/ }).click();
  await page.getByRole('button', { name: 'Keluar' }).click();
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByText('Anda telah keluar.')).toBeVisible();

  // protected route after logout
  await page.goto('/workspace');
  await expect(page).toHaveURL(/\/login$/);
});
