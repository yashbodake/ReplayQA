import { test, expect } from '../src/runner/index.js';

test('TC-001 Create a new todo with valid text', async ({ page }) => {
  // Navigate to the TodoMVC Vue example
  await page.goto('https://todomvc.com/examples/vue/dist/');

  const todoText = 'Buy milk';

  // Locate the "What needs to be done?" input and add a new todo
  const todoInput = page.getByPlaceholder('What needs to be done?');
  await expect(todoInput).toBeVisible();
  await todoInput.fill(todoText);
  await todoInput.press('Enter');

  // Verify the new todo appears in the list
  const todoItem = page.getByRole('listitem').filter({ hasText: todoText }).first();
  await expect(todoItem).toBeVisible();

  // Verify its checkbox is present and unchecked
  const checkbox = todoItem.getByRole('checkbox');
  await expect(checkbox).not.toBeChecked();
});
