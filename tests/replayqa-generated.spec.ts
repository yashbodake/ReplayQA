import { test, expect } from '../src/runner/index.js';

test('TC-004: Attempt to save an edited contact with an empty name', async ({ page }) => {
  // Navigate to the application
  await page.goto('file:///home/yash/Documents/Projects/ReplayQA/src/discovery/state-lab/fixture/sample-app.html');

  // Go to the Contacts list page
  const contactsLink = page.getByRole('link', { name: 'Contacts' });
  await expect(contactsLink).toBeVisible();
  await contactsLink.click();

  // Click the first Edit button
  const editButton = page.getByRole('button', { name: 'Edit' }).first();
  await expect(editButton).toBeVisible();
  await editButton.click();

  // Locate the name input in the edit form and clear it
  const nameInput = page.getByRole('textbox', { name: /name/i }).first();
  await expect(nameInput).toBeVisible();
  await nameInput.fill('');

  // Click the Save button in the edit form
  const saveButton = page.getByRole('button', { name: 'Save' }).first();
  await expect(saveButton).toBeVisible();
  await saveButton.click();

  // Verify that a validation error is shown for the empty name
  await expect(page.getByText('Name is required', { exact: true })).toBeVisible();
});
