import { expect, test } from '@playwright/test';

test('rejected migration rows stay visible until the complete corrected file is staged', async ({ page }) => {
  const requests: unknown[] = [];
  await page.route('**/api/v1/migration/batches/test-batch/stage', async route => {
    const body = route.request().postDataJSON();
    requests.push(body);
    const errors = requests.length === 1 ? [{ row: 3, message: 'Invalid email address' }] : [];
    await route.fulfill({ status: 200, contentType: 'application/json',
      body: JSON.stringify({ staged: errors.length ? 1 : 2, errors }) });
  });
  await page.goto('/e2e/fixtures/migration-stage.html');
  const upload = async (csv: string) => {
    await page.locator('input[type=file]').setInputFiles({
      name: 'customers.csv', mimeType: 'text/csv', buffer: Buffer.from(csv),
    });
    await page.getByRole('button', { name: 'Next: preview' }).click();
    await page.getByRole('button', { name: 'Stage 2 rows' }).click();
  };
  await upload('name,email\nAlpha,alpha@example.com\nBeta,bad-email');
  await expect(page.getByText('Row 3: Invalid email address')).toBeVisible();
  await expect(page.getByText(/1 valid rows are staged/)).toBeVisible();
  await expect(page.getByText('Step completed')).toHaveCount(0);
  await page.getByRole('button', { name: 'Back to mapping' }).click();
  await page.getByRole('button', { name: 'Back to upload' }).click();
  await expect(page.getByRole('button', { name: 'Skip this step' })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Back', exact: true })).toBeDisabled();
  await expect(page.getByRole('alert')).toContainText('corrected complete file');
  await upload('name,email\nAlpha,alpha@example.com\nBeta,beta@example.com');
  await expect(page.getByText('Step completed')).toBeVisible();
  expect(requests).toEqual([
    { entity: 'customers', rows: [
      { name: 'Alpha', email: 'alpha@example.com' }, { name: 'Beta', email: 'bad-email' },
    ] },
    { entity: 'customers', rows: [
      { name: 'Alpha', email: 'alpha@example.com' }, { name: 'Beta', email: 'beta@example.com' },
    ] },
  ]);
});
