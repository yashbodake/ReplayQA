import { test, expect } from '../src/runner/index.js';

test('TC-001 - Add a new todo with valid text', async ({ page }) => {
  // Navigate to the TodoMVC Vue example
  await page.goto('https://todomvc.com/examples/vue/dist/');

  // Locate the new todo input by its placeholder text and add a todo
  const todoInput = page.getByPlaceholder('What needs to be done?');
  await todoInput.fill('Fake Todo Item');
  await todoInput.press('Enter');

  // Verify that the entered todo appears in the list
  await expect(page.getByText('Fake Todo Item')).toBeVisible();
});
