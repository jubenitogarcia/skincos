const { chromium } = require('playwright');

const BASE_URL = process.env.BASE_URL || 'https://crm.skincos.com.br';
const HEADED = process.env.HEADED === '1';

function hasLoginSignals(text) {
  return /\b(login|entrar|senha|password|email)\b/i.test(text || '');
}

(async () => {
  const browser = await chromium.launch({ headless: !HEADED });
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 13_6) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    viewport: { width: 1280, height: 720 },
  });

  const page = await context.newPage();
  const consoleErrors = [];
  page.on('console', (msg) => {
    if (['error', 'warning'].includes(msg.type())) consoleErrors.push(`[console.${msg.type()}] ${msg.text()}`);
  });

  const res = await page.goto(BASE_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(1500);

  const url = page.url();
  const title = await page.title().catch(() => '');
  const bodyText = await page.textContent('body').catch(() => '') || '';

  await page.screenshot({ path: 'output/playwright/crm-home.png', fullPage: true });

  const hasPonto = await page.getByText('Ponto', { exact: false }).first().isVisible().catch(() => false);
  const loginLike = hasLoginSignals(title) || hasLoginSignals(bodyText) || /\/login/i.test(url);

  const out = {
    status: res ? res.status() : null,
    url,
    title,
    hasPonto,
    loginLike,
    consoleErrors: consoleErrors.slice(0, 15),
  };

  console.log(JSON.stringify(out, null, 2));

  await browser.close();
})();
