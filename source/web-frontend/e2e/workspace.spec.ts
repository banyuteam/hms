import { expect, test } from '@playwright/test';

test('static demo account: sign in → open window → dock → switch language → sign out', async ({
  page,
}) => {
  await page.goto('/');
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByText('Akun demo — hanya untuk peragaan')).toBeVisible();

  // wrong password first
  await page.getByLabel('Nama pengguna', { exact: true }).fill('demo.dokter');
  await page.getByLabel('Kata sandi', { exact: true }).fill('salah');
  await page.getByRole('button', { name: 'Masuk' }).click();
  await expect(page.getByRole('alert')).toContainText('salah');

  await page.getByLabel('Nama pengguna', { exact: true }).fill('demo.dokter');
  await page.getByLabel('Kata sandi', { exact: true }).fill('Demo#2026');
  await page.getByRole('button', { name: 'Masuk' }).click();
  await expect(page).toHaveURL(/\/workspace$/);

  // the session is in memory only
  expect(await page.evaluate(() => Object.keys(window.localStorage))).toEqual([]);
  expect(await page.evaluate(() => Object.keys(window.sessionStorage))).toEqual([]);

  await page.getByRole('button', { name: /Manajemen Pasien/ }).click();
  const win = page.getByRole('dialog', { name: 'Manajemen Pasien' });
  await expect(win).toBeVisible();
  const dock = page.getByRole('navigation', { name: 'Jendela terbuka' });
  await expect(dock.getByRole('button', { name: 'Manajemen Pasien', exact: true })).toHaveAttribute(
    'aria-current',
    'page',
  );

  // drag the window by its title bar
  const bar = win.getByRole('group', { name: 'Manajemen Pasien' });
  const before = await win.boundingBox();
  const b = (await bar.boundingBox())!;
  await page.mouse.move(b.x + 200, b.y + 20);
  await page.mouse.down();
  await page.mouse.move(b.x + 260, b.y + 60, { steps: 5 });
  await page.mouse.up();
  const after = await win.boundingBox();
  expect(after!.x).toBeGreaterThan(before!.x + 40);

  // minimise → tab stays → restore
  await win.getByRole('button', { name: 'Minimalkan Manajemen Pasien' }).click();
  await expect(win).toBeHidden();
  await dock.getByRole('button', { name: 'Manajemen Pasien', exact: true }).click();
  await expect(win).toBeVisible();

  // language is saved per browser
  await page.getByRole('button', { name: 'Menu pengguna' }).click();
  await page.getByRole('radio', { name: 'Ganti bahasa ke English' }).click();
  await page.keyboard.press('Escape'); // close the popover
  await expect(page.getByRole('dialog', { name: 'Patient Management' })).toBeVisible();
  expect(await page.evaluate(() => window.localStorage.getItem('hms.locale'))).toBe('en');

  // sign out
  await page.getByRole('button', { name: 'User menu' }).click();
  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByText('You have signed out.')).toBeVisible();

  // protected route after logout
  await page.goto('/workspace');
  await expect(page).toHaveURL(/\/login$/);
});
