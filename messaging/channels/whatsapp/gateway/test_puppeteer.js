// Teste simples do Puppeteer
const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');

async function testPuppeteer() {
    console.log('🧪 Testando Puppeteer...');

    try {
        // Verificar se Chromium foi baixado
        const chromiumPath = path.join(__dirname, 'node_modules/puppeteer/.local-chromium');
        console.log('📁 Verificando Chromium em:', chromiumPath);

        if (fs.existsSync(chromiumPath)) {
            console.log('✅ Diretório do Chromium encontrado');
            const revisions = fs.readdirSync(chromiumPath);
            console.log('📋 Revisões encontradas:', revisions);
        } else {
            console.log('❌ Diretório do Chromium não encontrado');
        }

        // Tentar lançar o browser
        console.log('🚀 Tentando lançar browser...');
        const browser = await puppeteer.launch({
            headless: 'new',
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage'
            ]
        });

        console.log('✅ Browser lançado com sucesso!');

        const page = await browser.newPage();
        await page.goto('https://example.com');
        console.log('✅ Página carregada com sucesso!');

        await browser.close();
        console.log('✅ Teste do Puppeteer concluído com sucesso!');

    } catch (error) {
        console.error('❌ Erro no teste do Puppeteer:', error.message);
        console.error('Stack:', error.stack);
        process.exit(1);
    }
}

testPuppeteer();
