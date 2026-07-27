import { test, expect } from '../src/runner/index.js';

test('TC-001 Successful login with valid credentials', async ({ page }) => {
  // Navigate to the application
  await page.goto('http://localhost:8080/');
  await page.waitForLoadState('networkidle');

  // Wait for the login form inputs to be visible (the form may be already present)
  const usernameInput = page.locator('input[name="loginUsername"]');
  const passwordInput = page.locator('input[name="loginPassword"]');
  await usernameInput.waitFor({ state: 'visible', timeout: 15000 });
  await passwordInput.waitFor({ state: 'visible', timeout: 15000 });

  // Verify visibility using expect (assertion style)
  await expect(usernameInput).toBeVisible();
  await expect(passwordInput).toBeVisible();

  // Fill in login credentials
  await usernameInput.fill('validUser');
  await passwordInput.fill('ValidPass123');

  // Click the submit button inside the login form (the second "Sign In" button)
  const submitButton = page.getByRole('button', { name: 'Sign In' }).last();
  await expect(submitButton).toBeVisible();
  await submitButton.click();

  // Wait for navigation to the contacts page
  await page.waitForURL('**/contacts**', { timeout: 15000 });

  // Verify that the user is redirected to the My Contacts page
  const heading = page.getByRole('heading', { name: 'My Contacts' }).first();
  await expect(heading).toBeVisible();

  // Verify that the Add Contact button is visible
  const addContactButton = page.getByRole('button', { name: 'Add Contact' }).first();
  await expect(addContactButton).toBeVisible();
});
