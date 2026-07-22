import { test, expect } from '../src/runner/index.js';

test('TC-001: Create a new todo with valid text', async ({ page }) => {
  await page.goto('https://todomvc.com/examples/vue/dist/');
  const todoInput = page.getByPlaceholder('What needs to be done?');
  const todoText = 'Buy milk';
  await todoInput.fill(todoText);
  await todoInput.press('Enter');
  await expect(page.getByText(todoText).first()).toBeVisible();
});
