import { test, expect } from '../src/runner/index.js';

test.describe('ReplayQA sample tests', () => {
  test('homepage loads with expected title', async ({ page }) => {
    await page.goto('/');

    await expect(page).toHaveTitle(/Phonebook/);
  });

  test('homepage responds with status 200', async ({ page }) => {
    const response = await page.goto('/');

    expect(response).not.toBeNull();
    expect(response!.status()).toBe(200);
  });
});
