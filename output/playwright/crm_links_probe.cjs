const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 13_6) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    viewport: { width: 1280, height: 720 },
  });
  const page = await context.newPage();
  await page.goto('https://crm.skincos.com.br/', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(1000);

  const candidates = [];
  for (const sel of ['a','button']) {
    const els = await page.locator(sel).all();
    for (const el of els) {
      const txt = (await el.innerText().catch(()=>''))?.trim();
      if (!txt) continue;
      if (/entrar|login|acessar|sign in/i.test(txt)) {
        const href = sel === 'a' ? await el.getAttribute('href').catch(()=>null) : null;
        candidates.push({ tag: sel, text: txt, href });
      }
    }
  }

  console.log(JSON.stringify(candidates.slice(0, 30), null, 2));
  await browser.close();
})();
