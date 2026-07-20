import { test, expect } from '../src/runner/index.js';

const BASE_URL = 'https://phone-book-yrap.vercel.app/';

async function registerUser(page, username, email, password) {
  await page.goto(BASE_URL);
  await page.getByRole('link', { name: /sign up/i }).click();
  await expect(page.locator('#registerUsername')).toBeVisible();
  await page.locator('#registerUsername').fill(username);
  await page.locator('#registerEmail').fill(email);
  await page.locator('#registerPassword').fill(password);
  await page.locator('#confirmPassword').fill(password);
  await page.getByRole('button', { name: /create account/i }).click();
  
  // Wait for navigation to contact list - look for the navbar Add Contact button
  await expect(page.locator('button[aria-label="Add new contact"]')).toBeVisible({ timeout: 30000 });
}

async function loginUser(page, username, password) {
  await page.goto(BASE_URL);
  await expect(page.locator('#loginUsername')).toBeVisible();
  await page.locator('#loginUsername').fill(username);
  await page.locator('#loginPassword').fill(password);
  await page.getByRole('button', { name: /sign in/i }).click();
  
  await expect(page.locator('button[aria-label="Add new contact"]')).toBeVisible({ timeout: 30000 });
}

async function addContact(page, contact) {
  // Use the navbar "Add Contact" button (has aria-label)
  await page.locator('button[aria-label="Add new contact"]').click();
  await expect(page.locator('#name')).toBeVisible();
  await page.locator('#name').fill(contact.name);
  await page.locator('#phone').fill(contact.phone);
  await page.locator('#email').fill(contact.email);
  await page.locator('#address').fill(contact.address);
  // Submit button inside the form
  await page.locator('form').getByRole('button', { name: /add contact/i }).click();
  await page.waitForLoadState('networkidle');
}

async function searchContacts(page, term) {
  await page.getByPlaceholder(/search contacts/i).fill(term);
  await page.waitForLoadState('networkidle');
}

async function editFirstContact(page, newName) {
  await page.locator('.card-custom.clickable').first().click();
  await expect(page.getByRole('heading', { name: 'Contact Details' })).toBeVisible();
  await page.getByRole('button', { name: /edit contact/i }).click();
  await expect(page.locator('#editName')).toBeVisible();
  await page.locator('#editName').fill(newName);
  // Wait for PUT response AND click together
  const [response] = await Promise.all([
    page.waitForResponse(
      (resp) => resp.url().includes('/api/contacts/') && resp.request().method() === 'PUT'
    ),
    page.getByRole('button', { name: /save changes/i }).click(),
  ]);
  expect(response.ok()).toBeTruthy();
  // Wait for navigation back to contact list
  await expect(page.getByRole('heading', { name: 'My Contacts' })).toBeVisible({ timeout: 15000 });
  await expect(page.locator('.card-custom.clickable').first()).toContainText(newName, { timeout: 10000 });
}

async function deleteFirstContact(page) {
  await page.locator('.card-custom.clickable').first().click();
  await expect(page.getByRole('heading', { name: 'Contact Details' })).toBeVisible();
  // Register dialog handler BEFORE clicking delete
  page.once('dialog', async (dialog) => {
    await dialog.accept();
  });
  // Wait for DELETE response AND click together
  const [response] = await Promise.all([
    page.waitForResponse(
      (resp) => resp.url().includes('/api/contacts/') && resp.request().method() === 'DELETE'
    ),
    page.getByRole('button', { name: /^delete$/i }).click(),
  ]);
  expect(response.ok()).toBeTruthy();
  // Wait for navigation back to contact list
  await expect(page.getByRole('heading', { name: 'My Contacts' })).toBeVisible({ timeout: 15000 });
  await expect(page.locator('text=No contacts yet')).toBeVisible({ timeout: 10000 });
}

async function logout(page) {
  await page.getByRole('button', { name: /logout/i }).click();
  await page.waitForLoadState('networkidle');
  await expect(page.locator('#loginUsername')).toBeVisible();
}

test.describe('Phonebook Pro - Auth Flow', () => {
  test('should register a new user and redirect to contacts', async ({ page }) => {
    const username = `test_${Date.now()}`;
    const email = `${username}@test.com`;
    await registerUser(page, username, email, 'Test123!');
    // Verify we're on contacts page by checking for navbar
    await expect(page.locator('button[aria-label="Add new contact"]')).toBeVisible();
  });

  test('should login with existing user', async ({ page }) => {
    // First register a user
    const username = `test_${Date.now()}`;
    const email = `${username}@test.com`;
    await registerUser(page, username, email, 'Test123!');
    await logout(page);
    
    // Then login
    await loginUser(page, username, 'Test123!');
    await expect(page.locator('button[aria-label="Add new contact"]')).toBeVisible();
  });
});

test.describe('Phonebook Pro - Contact CRUD', () => {
  let username;

  test.beforeEach(async ({ page }) => {
    username = `test_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const email = `${username}@test.com`;
    await registerUser(page, username, email, 'Test123!');
  });

  test('should add a new contact', async ({ page }) => {
    const phone = `${Date.now()}`.slice(-10);
    await addContact(page, {
      name: 'John Doe',
      phone,
      email: 'john@example.com',
      address: '123 Main St'
    });
    // Verify contact appears in list
    await expect(page.locator('.card-custom.clickable').first()).toContainText('John Doe');
  });

  test('should search contacts by name', async ({ page }) => {
    const phone = `${Date.now()}`.slice(-10);
    await addContact(page, {
      name: 'Alice Search',
      phone,
      email: 'alice@example.com',
      address: '456 Oak Ave'
    });
    await searchContacts(page, 'Alice');
    await expect(page.locator('.card-custom.clickable').first()).toContainText('Alice Search');
  });

  test('should edit a contact', async ({ page }) => {
    const phone = `${Date.now()}`.slice(-10);
    await addContact(page, {
      name: 'Bob Edit',
      phone,
      email: 'bob@example.com',
      address: '789 Pine Rd'
    });
    await editFirstContact(page, 'Bob Updated');
  });

  test('should delete a contact', async ({ page }) => {
    const phone = `${Date.now()}`.slice(-10);
    await addContact(page, {
      name: 'Charlie Delete',
      phone,
      email: 'charlie@example.com',
      address: '321 Elm Blvd'
    });
    await deleteFirstContact(page);
  });
});

test.describe('Phonebook Pro - Full Flow', () => {
  test('complete user journey: register, add, search, edit, delete, logout', async ({ page }) => {
    const username = `test_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const email = `${username}@test.com`;
    const phone = `${Date.now()}`.slice(-10);
    
    // Register
    await registerUser(page, username, email, 'Test123!');
    
    // Add contact
    await addContact(page, {
      name: 'Full Flow Contact',
      phone,
      email: 'flow@example.com',
      address: '100 Flow St'
    });
    
    // Search
    await searchContacts(page, 'Full Flow');
    await expect(page.locator('.card-custom.clickable').first()).toContainText('Full Flow Contact');
    
    // Edit
    await editFirstContact(page, 'Full Flow Updated');
    
    // Delete
    await deleteFirstContact(page);
    
    // Logout
    await logout(page);
  });
});