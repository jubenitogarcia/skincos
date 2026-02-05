const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

const BASE_URL = process.env.BASE_URL || 'https://crm.skincos.com.br';
const HEADED = process.env.HEADED === '1';
const ALLOW_MUTATIONS = process.env.ALLOW_MUTATIONS === '1';

const outDir = path.resolve('output/playwright');
fs.mkdirSync(outDir, { recursive: true });

function logStep(n, msg) {
  console.log(`\n[STEP ${n}] ${msg}`);
}

async function screenshot(page, name) {
  const p = path.join(outDir, name);
  await page.screenshot({ path: p, fullPage: true }).catch(() => {});
  return p;
}

async function ensureLoggedInAndOnPonto(page) {
  // Deep-link directly to module.
  await page.goto(`${BASE_URL}/?module=ponto`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(1200);

  const hasPontoHeader = await page.locator('h2', { hasText: 'Ponto' }).first().isVisible().catch(() => false);
  if (hasPontoHeader) return;

  // Landing page: open login modal if needed.
  const accessBtn = page.getByRole('button', { name: /acessar plataforma|entrar/i }).first();
  if (await accessBtn.isVisible().catch(() => false)) {
    await accessBtn.click().catch(() => {});
    await page.waitForTimeout(500);
  }

  const emailInput = page.locator('input[type="email"], input[name="email"], #auth-email').first();
  const passInput = page.locator('input[type="password"], input[name="password"], #auth-password').first();
  const canFill = (await emailInput.isVisible().catch(() => false)) && (await passInput.isVisible().catch(() => false));

  const email = String(process.env.CRM_EMAIL || '').trim();
  const password = String(process.env.CRM_PASSWORD || '').trim();
  if (canFill && email && password) {
    await emailInput.fill(email);
    await passInput.fill(password);
    // Try submit: Enter or a submit button.
    await passInput.press('Enter').catch(() => {});
  } else {
    console.log('[ACTION REQUIRED] Faça login manualmente na janela do browser (Playwright).');
  }

  // Poll auth state (session cookie) until /api/auth/me returns 200.
  // This avoids re-navigating while the user is typing credentials.
  const deadline = Date.now() + 10 * 60 * 1000;
  while (Date.now() < deadline) {
    try {
      const resp = await page.request.get(`${BASE_URL}/api/auth/me`, { timeout: 15000 });
      if (resp.ok()) break;
    } catch {
      // ignore
    }
    await page.waitForTimeout(1200);
  }

  // Now re-enter Ponto and wait for module header.
  await page.goto(`${BASE_URL}/?module=ponto`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(800);
  await page.waitForSelector('h2:has-text("Ponto")', { timeout: 2 * 60 * 1000 });
}

async function parseJsonFromPre(preLocator) {
  const text = (await preLocator.innerText().catch(() => '')).trim();
  if (!text || text === '—') return null;
  try { return JSON.parse(text); } catch { return { nonJson: true, raw: text.slice(0, 500) }; }
}

(async () => {
  const userDataDir = path.join(outDir, 'profile');

  logStep(1, 'Abrir CRM e entrar no módulo Ponto (deep-link /?module=ponto).');
  const context = await chromium.launchPersistentContext(userDataDir, {
    headless: !HEADED,
    viewport: { width: 1440, height: 900 },
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 13_6) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
  });

  const page = await context.newPage();

  await context.tracing.start({ screenshots: true, snapshots: true });

  try {
    await ensureLoggedInAndOnPonto(page);
    await screenshot(page, 'ponto-home.png');

    logStep(2, 'Validar que Build + botão Diagnóstico aparecem.');
    await page.getByText(/Build:/i).first().waitFor({ timeout: 30000 });
    await page.getByRole('button', { name: 'Diagnóstico' }).waitFor({ timeout: 30000 });

    logStep(3, 'Abrir Diagnóstico e validar JSON de proxy-status e health.');
    await page.getByRole('button', { name: 'Diagnóstico' }).click();
    await page.getByText('Diagnóstico do Ponto').waitFor({ timeout: 30000 });

    const preBlocks = page.locator('pre');
    const proxyPre = preBlocks.nth(0);
    const healthPre = preBlocks.nth(1);

    // Wait for JSON to populate.
    await page.waitForTimeout(1200);

    const proxyJson = await parseJsonFromPre(proxyPre);
    const healthJson = await parseJsonFromPre(healthPre);

    if (!proxyJson || proxyJson.ok !== true) throw new Error(`proxy-status invalid: ${JSON.stringify(proxyJson)}`);
    if (!proxyJson.targetConfigured) throw new Error('proxy-status targetConfigured=false');
    if (!proxyJson.adminTokenConfigured) throw new Error('proxy-status adminTokenConfigured=false');
    if (!proxyJson.actorKeyConfigured) throw new Error('proxy-status actorKeyConfigured=false');

    if (!healthJson || healthJson.ok !== true) throw new Error(`health invalid: ${JSON.stringify(healthJson)}`);

    // cryptoTemplates only exists after PR #102 deploy.
    if (Object.prototype.hasOwnProperty.call(healthJson, 'cryptoTemplates') && healthJson.cryptoTemplates !== true) {
      throw new Error(`health.cryptoTemplates expected true, got: ${healthJson.cryptoTemplates}`);
    }

    await screenshot(page, 'ponto-diagnostics.png');

    logStep(4, 'Validar Kiosk: PIN fallback não fica visível por padrão.');
    await page.getByRole('tab', { name: 'Kiosk' }).click();
    await page.waitForTimeout(800);
    const pinFallbackVisible = await page.getByText('Fallback por PIN', { exact: true }).isVisible().catch(() => false);
    if (pinFallbackVisible) throw new Error('Kiosk mostra "Fallback por PIN" sem fallback ter sido acionado.');
    await screenshot(page, 'ponto-kiosk.png');

    logStep(5, 'Validar Admin: não existe campo para token admin; acesso é por sessão do CRM.');
    const adminTab = page.getByRole('tab', { name: 'Admin' });
    const adminVisible = await adminTab.isVisible().catch(() => false);
    if (adminVisible) {
      await adminTab.click();
      await page.waitForTimeout(800);
      const tokenLike = await page.locator('input[placeholder*="token" i], input[placeholder*="admin" i]').count();
      if (tokenLike > 0) throw new Error('Admin ainda exibe campo de token.');
      await screenshot(page, 'ponto-admin.png');

      if (ALLOW_MUTATIONS) {
        logStep(6, 'ALLOW_MUTATIONS=1: criar funcionário de teste (E2E) e validar criação.');
        const name = `E2E ${new Date().toISOString()}`;
        const code = `E2E-${Date.now()}`;
        await page.getByLabel('Novo nome').fill(name);
        await page.getByLabel('Código (opcional)').fill(code);
        await page.getByRole('button', { name: 'Criar' }).click();
        await page.waitForTimeout(1500);
        // A lista de selecionado deve conter o nome.
        const found = await page.getByRole('option', { name: new RegExp(name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')) }).first().isVisible().catch(() => false);
        if (!found) throw new Error('Funcionário E2E não apareceu na lista após criar.');
        await screenshot(page, 'ponto-admin-created.png');
      }
    } else {
      console.log('[INFO] Aba Admin não visível (usuário não-admin). Validação de token admin pulada.');
    }

    console.log('\nRESULT: OK');
  } catch (err) {
    console.error('\nRESULT: FAIL');
    console.error(err?.stack || String(err));
    await screenshot(page, 'ponto-failure.png');
    process.exitCode = 1;
  } finally {
    const tracePath = path.join(outDir, 'ponto-trace.zip');
    await context.tracing.stop({ path: tracePath }).catch(() => {});
    await context.close().catch(() => {});
    console.log(`\nArtifacts: ${outDir}`);
  }
})();
