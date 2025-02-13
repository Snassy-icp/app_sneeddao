import { test, expect } from '@playwright/test';
import { login } from '../utils/login';

test('add_token_canister', async ({ page }) => {

  // login
  const accountName = 'TEST_II_1';
  await login(page, 'https://2icdp-6qaaa-aaaal-qjt6a-cai.icp0.io/', accountName);

  // add a token canister and assert on what it contains
  await page.locator('p').filter({ hasText: 'Tokens +' }).locator('b').click();
  await page.getByLabel('ICRC1 Token Ledger Canister').click();
  await page.getByLabel('ICRC1 Token Ledger Canister').fill('6rdgd-kyaaa-aaaaq-aaavq-cai');
  await page.getByRole('button', { name: 'Submit' }).click();
  await page.waitForTimeout(5000); // sometimes adding canisters takes a while.
  await expect(page.locator('span')).toContainText('DOLR');
  await expect(page.locator('#root')).toContainText('0');
  await expect(page.locator('#root')).toContainText('0');
  await expect(page.locator('#root')).toContainText('No locks');
  await expect(page.getByText('DOLRAvailable0Locked0LocksNo')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Remove' })).toBeVisible();
  await page.getByRole('button', { name: 'Remove' }).click();
  await expect(page.locator('h2')).toContainText('Are you sure?');
  await expect(page.locator('#root')).toContainText('You are about to unregister ledger canister 6rdgd-kyaaa-aaaaq-aaavq-cai?');
  await expect(page.getByRole('button', { name: 'Ok' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Cancel' })).toBeVisible();
  await page.getByRole('button', { name: 'Ok' }).click();
});