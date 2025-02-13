import { test, expect } from '@playwright/test';
import { login } from '../utils/login';

test('login', async ({ page }) => { 
  const accountName = 'TEST_II_1';
  await login(page, 'https://2icdp-6qaaa-aaaal-qjt6a-cai.icp0.io/', accountName);

  const accountPrincipal = process.env[accountName + "_ID_PRINCIPAL"];
  const condensedPrincipal = accountPrincipal!.slice(0, 3) + '...' + accountPrincipal!.slice(-3);

  // now assert that the logged in page has all the right things.
  await expect(page.getByRole('button')).toContainText(condensedPrincipal);
  await page.getByRole('button', { name: condensedPrincipal }).click();
  await expect(page.getByRole('textbox')).toContainText(accountPrincipal!);
  await page.getByRole('button', { name: 'Close' }).click();
  await page.getByRole('button', { name: condensedPrincipal }).click();
  await page.getByRole('button', { name: 'Log Out' }).click();
  await expect(page.getByRole('button')).toContainText('Login with Internet Identity');
});