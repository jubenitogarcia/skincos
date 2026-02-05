import { chromium } from 'playwright';

const base = process.env.BASE_URL || 'https://crm.skincos.com.br';

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext();
const page = await context.newPage();

page.on('console', msg => {
  // keep concise
  if (['error','warning'].includes(msg.type())) {
    console.log(`[console.${msg.type()}]`, msg.text());
  }
});

const res = await page.goto(base, { waitUntil: 'domcontentloaded', timeout: 45000 });
console.log('goto.status', res?.status(), 'url', page.url());
console.log('title', await page.title());

await page.waitForTimeout(1500);
await page.screenshot({ path: 'output/playwright/crm-home.png', fullPage: true });

// naive detection for login
const bodyText = (await page.textContent('body').catch(() => '')) || '';
const looksLikeLogin = /login|entrar|senha|email/i.test(bodyText) && /crm/i.test((await page.title().catch(()=>'')) || '') === false;
console.log('looksLikeLogin', looksLikeLogin);

await browser.close();
