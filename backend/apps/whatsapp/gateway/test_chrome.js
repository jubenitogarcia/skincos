const puppeteer = require('puppeteer');

async function testChrome() {
    console.log('🧪 Testando inicialização do Chrome...');

    try {
        console.log('1. Iniciando browser...');
        const browser = await puppeteer.launch({
            headless: 'new',
            executablePath: '/usr/bin/google-chrome-stable',
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-gpu',
                '--disable-gpu-sandbox',
                '--no-first-run',
                '--disable-extensions',
                '--disable-default-apps',
                '--disable-background-timer-throttling',
                '--disable-renderer-backgrounding',
                '--disable-backgrounding-occluded-windows',
                '--disable-client-side-phishing-detection',
                '--disable-hang-monitor',
                '--disable-popup-blocking',
                '--disable-prompt-on-repost',
                '--disable-sync',
                '--disable-translate',
                '--metrics-recording-only',
                '--no-crash-upload',
                '--safebrowsing-disable-auto-update',
                '--disable-features=VizDisplayCompositor',
                '--disable-blink-features=AutomationControlled',
                '--user-data-dir=/tmp/chrome-user-data',
                '--remote-debugging-port=0',
                '--disable-web-security',
                '--disable-features=site-per-process'
            ],
            timeout: 60000,
            dumpio: true
        });

        console.log('✅ Browser iniciado com sucesso!');

        console.log('2. Criando nova página...');
        const page = await browser.newPage();
        console.log('✅ Página criada com sucesso!');

        console.log('3. Navegando para página de teste...');
        await page.goto('data:text/html,<h1>Teste OK!</h1>', { waitUntil: 'networkidle0', timeout: 30000 });
        console.log('✅ Navegação realizada com sucesso!');

        console.log('4. Fechando recursos...');
        await page.close();
        await browser.close();
        console.log('✅ Recursos fechados com sucesso!');

        console.log('🎉 Teste do Chrome PASSOU! O ambiente está OK.');

    } catch (error) {
        console.error('❌ Teste do Chrome FALHOU:', error.message);
        console.error('Stack trace:', error.stack);
        process.exit(1);
    }
}

// Executar teste se chamado diretamente
if (require.main === module) {
    testChrome();
}

module.exports = testChrome;
