export async function login(page, url, iiAccountEnvVarName) {
    const iiAccountNumber = process.env[iiAccountEnvVarName + "_ID_NUMBER"];
    const recoveryPhrase = process.env[iiAccountEnvVarName + "_RECOVERY_PHRASE"].split(' ');

    await page.goto(url);
    const page1Promise = page.waitForEvent('popup');
    await page.getByRole('button', { name: 'Login with Internet Identity' }).click();
    const page1 = await page1Promise;
    await page1.getByRole('button', { name: 'Use existing' }).click();
    await page1.getByText('Lost Access?').click();
    await page1.getByRole('button', { name: 'Use recovery phrase' }).click();
    await page1.getByPlaceholder('Identity number').fill(iiAccountNumber);

    for (let i = 0; i < recoveryPhrase.length; i++) {
      await page1.locator(`li:nth-child(${i + 2}) > .c-recoveryInput`).fill(recoveryPhrase[i]);
      if (i < recoveryPhrase.length - 1) {
        await page1.locator(`li:nth-child(${i + 2}) > .c-recoveryInput`).press('Tab');
      }
    }
  
    await page1.getByRole('button', { name: 'Continue' }).click();
    await page1.getByRole('button', { name: 'Skip' }).click();
    await page.waitForTimeout(7000); // wait for ii to redirect back to the app
}