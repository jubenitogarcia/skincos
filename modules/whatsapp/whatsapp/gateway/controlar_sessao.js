const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');

class WhatsAppController {
    constructor() {
        this.client = null;
        this.isReady = false;
    }

    async iniciar() {
        console.log('🚀 Iniciando WhatsApp...');

        this.client = new Client({
            authStrategy: new LocalAuth(),
            puppeteer: {
                headless: false,
                args: [
                    '--no-sandbox',
                    '--disable-setuid-sandbox',
                    '--disable-dev-shm-usage',
                    '--disable-accelerated-2d-canvas',
                    '--no-first-run',
                    '--no-zygote',
                    '--disable-gpu'
                ]
            }
        });

        this.client.on('qr', (qr) => {
            console.log('📱 QR Code recebido, escaneie com seu telefone:');
            qrcode.generate(qr, { small: true });
        });

        this.client.on('ready', () => {
            console.log('✅ WhatsApp Web está pronto!');
            this.isReady = true;
        });

        this.client.on('authenticated', () => {
            console.log('🔐 Autenticado com sucesso!');
        });

        this.client.on('disconnected', (reason) => {
            console.log('⚠️ Desconectado:', reason);
            this.isReady = false;
        });

        await this.client.initialize();
    }

    async fecharJanela() {
        if (!this.client || !this.client.pupPage) {
            console.log('❌ Nenhuma janela ativa encontrada');
            return false;
        }

        try {
            console.log('🔒 Fechando janela do WhatsApp Web...');
            await this.client.pupPage.close();
            console.log('✅ Janela fechada com sucesso');
            return true;
        } catch (error) {
            console.log('❌ Erro ao fechar janela:', error.message);
            return false;
        }
    }

    async abrirJanela() {
        if (!this.client || !this.client.pupBrowser) {
            console.log('❌ Navegador não está disponível');
            return false;
        }

        try {
            console.log('🌐 Abrindo nova janela do WhatsApp Web...');

            // Criar nova página
            const page = await this.client.pupBrowser.newPage();

            // Configurar a página
            await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36');

            // Navegar para WhatsApp Web
            await page.goto('https://web.whatsapp.com', {
                waitUntil: 'networkidle0',
                timeout: 60000
            });

            // Atualizar referência da página no client
            this.client.pupPage = page;

            console.log('✅ Nova janela aberta com sucesso');
            return true;
        } catch (error) {
            console.log('❌ Erro ao abrir janela:', error.message);
            return false;
        }
    }

    async refresh() {
        console.log('🔄 Iniciando refresh da sessão...');

        const fechou = await this.fecharJanela();
        if (fechou) {
            await new Promise(resolve => setTimeout(resolve, 2000)); // Aguardar 2 segundos
            await this.abrirJanela();
        }
    }

    async status() {
        if (!this.client) {
            return { status: 'stopped', ready: false };
        }

        const info = await this.client.getState();
        return {
            status: 'running',
            ready: this.isReady,
            state: info,
            hasPage: !!this.client.pupPage
        };
    }
}

// Interface de linha de comando
if (require.main === module) {
    const controller = new WhatsAppController();
    const comando = process.argv[2];

    switch (comando) {
        case 'iniciar':
            controller.iniciar();
            break;

        case 'fechar':
            controller.fecharJanela().then(() => process.exit(0));
            break;

        case 'abrir':
            controller.abrirJanela().then(() => process.exit(0));
            break;

        case 'refresh':
            controller.refresh().then(() => process.exit(0));
            break;

        case 'status':
            controller.status().then(status => {
                console.log('📊 Status:', JSON.stringify(status, null, 2));
                process.exit(0);
            });
            break;

        default:
            console.log(`
🎮 Controles do WhatsApp Web:

Comandos disponíveis:
  node controlar_sessao.js iniciar  - Iniciar WhatsApp
  node controlar_sessao.js fechar   - Fechar janela (manter sessão)
  node controlar_sessao.js abrir    - Abrir nova janela
  node controlar_sessao.js refresh  - Fechar e abrir novamente
  node controlar_sessao.js status   - Ver status atual
            `);
    }
}

module.exports = WhatsAppController;
