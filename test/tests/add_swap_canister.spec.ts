import { test, expect } from '@playwright/test';
import { login } from '../utils/login';

test('add_swap_canister', async ({ page }) => {

  test.setTimeout(60000);

  await login(page, 'https://2icdp-6qaaa-aaaal-qjt6a-cai.icp0.io/', 'TEST_II_1');

  await expect(page.getByText('DisclaimerThis is beta')).toBeVisible();
  await expect(page.locator('p').filter({ hasText: 'Liquidity Positions +' }).locator('b')).toBeVisible();
  await page.locator('p').filter({ hasText: 'Liquidity Positions +' }).locator('b').click();
  await expect(page.getByText('Add Swap Pool CanisterICPSwap')).toBeVisible();
  await page.getByLabel('ICPSwap Swap Pool Canister Id:').click();
  await page.getByLabel('ICPSwap Swap Pool Canister Id:').fill('ijd5l-jyaaa-aaaag-qdjga-cai');
  await page.getByRole('button', { name: 'Submit' }).click();
  await page.waitForTimeout(14000); // wait for the swap canister to be visible
  await expect(page.getByText('Add Swap Pool CanisterICPSwap')).toHaveCount(0);
  await expect(page.getByText('ICP/DKPNo Positions')).toBeVisible();
  await expect(page.locator('span')).toContainText('ICP/DKP');
  await expect(page.locator('#root')).toContainText('No Positions');
  await page.getByRole('button', { name: 'Remove' }).click();
  await expect(page.locator('#root')).toContainText('You are about to unregister swap canister ijd5l-jyaaa-aaaag-qdjga-cai?');
  await expect(page.getByText('Are you sure?You are about to')).toBeVisible();
  await page.getByRole('button', { name: 'Ok' }).click();
  await page.waitForTimeout(7000); // wait for the swap canister to disappear
  await expect(page.getByText('Are you sure?You are about to')).toHaveCount(0);
  await expect(page.getByText('ICP/DKPNo Positions')).toHaveCount(0);
});