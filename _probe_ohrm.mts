import { chromium } from 'playwright';
const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext();
await ctx.addInitScript('globalThis.__name=(t,v)=>{try{Object.defineProperty(t,"name",{value:v,configurable:true})}catch(e){}return t}');
const page = await ctx.newPage();
await page.goto('https://opensource-demo.orangehrmlive.com/', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(2000);
const inputs = await page.evaluate(() => Array.from(document.querySelectorAll('input')).map(i => ({
  type: i.type, name: i.name, id: i.id, placeholder: i.placeholder,
  visible: i.getBoundingClientRect().width > 0,
})));
const buttons = await page.evaluate(() => Array.from(document.querySelectorAll('button')).map(b => ({
  type: b.type, text: (b.textContent||'').trim(), visible: b.getBoundingClientRect().width > 0,
})).filter(b => b.visible));
console.log('INPUTS:', JSON.stringify(inputs, null, 2));
console.log('BUTTONS:', JSON.stringify(buttons, null, 2));
await browser.close();
