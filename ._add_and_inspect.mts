import { chromium } from 'playwright';
const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext();
await ctx.addInitScript('globalThis.__name=(t,v)=>{try{Object.defineProperty(t,"name",{value:v,configurable:true})}catch(e){}return t}');
const page = await ctx.newPage();
await page.goto('https://phone-book-yrap.vercel.app/');
await page.locator('#loginUsername').fill('yash');
await page.locator('#loginPassword').fill('Yash@9100');
await page.getByRole('button', { name: /sign in/i }).click();
await page.locator('button[aria-label="Add new contact"]').waitFor({ timeout: 15000 });
await page.waitForTimeout(1000);

// Add a contact
await page.locator('button[aria-label="Add new contact"]').click();
await page.locator('#name').fill('Jane Smith');
await page.locator('#phone').fill('555-9999');
await page.locator('#email').fill('jane@test.com');
await page.locator('#address').fill('123 Test St');
await page.locator('form').getByRole('button', { name: /add contact/i }).click();
await page.waitForLoadState('networkidle');
await page.waitForTimeout(1000);

// Now inspect the contact list structure
const cards = await page.evaluate(() => {
  const list = document.querySelector('.contact-list');
  if (!list) return [];
  const children = Array.from(list.children);
  return children.slice(1).map((el, i) => {  // skip the heading child
    const rect = el.getBoundingClientRect();
    const style = getComputedStyle(el);
    return {
      index: i,
      tag: el.tagName,
      class: (el.className || '').toString().slice(0, 80),
      text: (el.textContent || '').trim().slice(0, 80),
      cursor: style.cursor,
      hasOnclick: el.hasAttribute('onclick'),
      w: Math.round(rect.width),
      h: Math.round(rect.height),
      hasButton: Boolean(el.querySelector('button')),
      hasLink: Boolean(el.querySelector('a[href]')),
      html: el.outerHTML.slice(0, 300),
    };
  });
});
console.log('Contact cards in list:', cards.length);
for (const c of cards) console.log(JSON.stringify(c, null, 2));
await browser.close();
