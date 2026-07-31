import { test, expect } from '../src/runner/index.js';

test('TC-001 Successful account creation with valid data', async ({ page }) => {
  // Navigate to the Welcome page
  await page.goto('https://phone-book-yrap.vercel.app/');

  // Open the Sign‑up form
  await page.getByRole('link', { name: /sign up/i }).click();

  // Ensure the registration form is visible (heading appears)
  await expect(page.getByRole('heading', { name: /create account/i })).toBeVisible({ timeout: 5000 });

  // Locate registration fields using role‑based selectors and scope to the first match
  const usernameInput = page.getByRole('textbox', { name: /username/i }).first();
  const emailInput = page.getByRole('textbox', { name: /email/i }).first();
  const passwordInput = page.getByLabel('Password').first();
  const confirmPasswordInput = page.getByLabel('Confirm Password').first();

  // Wait for the username field to be visible before interacting
  await expect(usernameInput).toBeVisible({ timeout: 5000 });

  // Fill in registration fields with valid data
  const uniqueSuffix = Date.now().toString();
  await usernameInput.fill(`testuser${uniqueSuffix}`);
  await emailInput.fill(`testuser${uniqueSuffix}@example.com`);
  await passwordInput.fill('Password123!');
  await confirmPasswordInput.fill('Password123!');

  // Submit the registration form
  await page.getByRole('button', { name: /create account/i }).click();

  // Verify that the UI transitions to the "My Contacts" page
  await expect(page.getByRole('heading', { name: /my contacts/i })).toBeVisible();
  await expect(page.getByRole('button', { name: /add contact/i })).toBeVisible();
});
