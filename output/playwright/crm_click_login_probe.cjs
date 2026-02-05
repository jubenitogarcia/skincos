const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 13_6) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    viewport: { width: 1280, height: 720 },
  });
  const page = await context.newPage();

  await page.goto('https://crm.skincos.com.br/', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(800);

  const btn = page.getByRole('button', { name: /acessar plataforma|entrar/i }).first();
  await btn.click({ timeout: 10000 });

  await page.waitForLoadState('domcontentloaded', { timeout: 60000 });
  await page.waitForTimeout(800);

  console.log(JSON.stringify({ url: page.url(), title: await page.title().catch(()=>''), status: (await page.request.get(page.url()).catch(()=>null))?.status?.() }, null, 2));
  await page.screenshot({ path: 'output/playwright/crm-after-login-click.png', fullPage: true });

  const inputTypes = await page.locator('input').evaluateAll(els => els.map(e => ({ type: e.getAttribute('type'), name: e.getAttribute('name'), id: e.getAttribute('id'), placeholder: e.getAttribute('placeholder') })).slice(0,20)).catch(()=>[]);
  console.log('inputs', JSON.stringify(inputTypes, null, 2));

  await browser.close();
})();
