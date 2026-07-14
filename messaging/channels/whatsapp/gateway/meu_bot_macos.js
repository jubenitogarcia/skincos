const { Client, LocalAuth } = require('./index');
const qrcode = require('qrcode-terminal');
const fs = require('fs');

console.log('🚀 Iniciando cliente WhatsApp (versão otimizada para macOS)...');

// Função para detectar o Chrome automaticamente
function findChrome() {
    const possiblePaths = [
        '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
        '/Applications/Chromium.app/Contents/MacOS/Chromium',
        '/usr/bin/google-chrome-stable',
        '/usr/bin/google-chrome',
        '/usr/bin/chromium-browser',
        '/usr/bin/chromium'
    ];

    for (const path of possiblePaths) {
        if (fs.existsSync(path)) {
            console.log(`✅ Chrome encontrado em: ${path}`);
            return path;
        }
    }

    console.log('⚠️ Chrome não encontrado nos caminhos padrão, usando Puppeteer padrão');
    return null;
}

// Configuração robusta do Puppeteer para macOS
const puppeteerConfig = {
    headless: false,
    timeout: 120000, // 2 minutos de timeout
    slowMo: 100, // Adicionar delay entre ações para estabilidade
    defaultViewport: null,
    args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-accelerated-2d-canvas',
        '--no-first-run',
        '--no-zygote',
        '--disable-gpu',
        '--disable-web-security',
        '--disable-features=VizDisplayCompositor',
        '--disable-background-timer-throttling',
        '--disable-backgrounding-occluded-windows',
        '--disable-renderer-backgrounding',
        '--disable-infobars',
        '--window-position=0,0',
        '--ignore-certifcate-errors',
        '--ignore-certifcate-errors-spki-list',
        '--ignore-ssl-errors',
        '--allow-running-insecure-content'
    ]
};

// Adicionar caminho do Chrome se encontrado
const chromePath = findChrome();
if (chromePath) {
    puppeteerConfig.executablePath = chromePath;
}

// Criar o cliente WhatsApp
const client = new Client({
    authStrategy: new LocalAuth({
        dataPath: '.wwebjs_auth'
    }),
    puppeteer: puppeteerConfig,
    webVersionCache: {
        type: 'remote',
        remotePath: 'https://raw.githubusercontent.com/wppconnect-team/wa-version/main/html/2.2412.54.html',
    }
});

console.log('🔧 Configurações aplicadas:');
console.log('   ✅ Timeout: 2 minutos');
console.log('   ✅ Argumentos otimizados para macOS');
console.log('   ✅ Cache de versão remoto');
console.log('   ✅ Autenticação local');

// Quando um QR Code for gerado
client.on('qr', (qr) => {
    console.log('📱 QR Code recebido! Escaneie com seu WhatsApp:');
    qrcode.generate(qr, { small: true });
    console.log('💡 Dica: Use o WhatsApp no celular > Menu > Dispositivos conectados > Conectar um dispositivo');
});

// Quando carregando
client.on('loading_screen', (percent, message) => {
    console.log(`⏳ Carregando... ${percent}% - ${message}`);
});

// Quando a autenticação for bem-sucedida
client.on('authenticated', () => {
    console.log('✅ Autenticado com sucesso!');
});

// Quando houver falha na autenticação
client.on('auth_failure', msg => {
    console.error('❌ Falha na autenticação:', msg);
    console.log('💡 Tente remover a pasta .wwebjs_auth e executar novamente');
});

// Quando o cliente estiver pronto
client.on('ready', async () => {
    console.log('🎉 Cliente WhatsApp está pronto!');
    console.log('💡 Envie "!ping" para qualquer chat para testar');

    // Obter informações do usuário
    try {
        const info = client.info;
        console.log(`📱 Conectado como: ${info.pushname} (${info.wid.user})`);

        // Obter versão do WhatsApp Web
        const version = await client.getWWebVersion();
        console.log(`🌐 Versão WhatsApp Web: ${version}`);
    } catch (error) {
        console.log('⚠️ Não foi possível obter informações adicionais');
    }
});

// Quando receber uma mensagem
client.on('message', async msg => {
    try {
        // Ignorar mensagens próprias e de status
        if (msg.fromMe || msg.from === 'status@broadcast') return;

        console.log(`📨 Mensagem recebida de ${msg.from}: ${msg.body}`);

        // Comando ping
        if (msg.body.toLowerCase() === '!ping') {
            await msg.reply('🏓 Pong! Bot macOS funcionando perfeitamente!');
            console.log('✅ Respondido com pong!');
        }

        // Comando de informações
        else if (msg.body.toLowerCase() === '!info') {
            const chat = await msg.getChat();
            const contact = await msg.getContact();

            let info = `ℹ️ *Informações:*\n`;
            info += `📞 Contato: ${contact.name || contact.pushname || 'Não disponível'}\n`;
            info += `💬 Chat: ${chat.name || 'Chat individual'}\n`;
            info += `🆔 ID do Chat: ${chat.id._serialized}\n`;
            info += `👥 É grupo: ${chat.isGroup ? 'Sim' : 'Não'}\n`;
            info += `🖥️ Sistema: macOS optimized`;

            await msg.reply(info);
        }

        // Comando de status do sistema
        else if (msg.body.toLowerCase() === '!status') {
            const uptime = process.uptime();
            const memory = process.memoryUsage();

            const statusInfo = `🖥️ *Status do Bot:*\n\n` +
                `⏱️ Tempo ativo: ${Math.floor(uptime / 60)}m ${Math.floor(uptime % 60)}s\n` +
                `💾 Memória: ${Math.round(memory.heapUsed / 1024 / 1024)}MB\n` +
                `🔄 Processo: Node.js ${process.version}\n` +
                `💻 Sistema: ${process.platform}\n` +
                `✅ Status: Funcionando perfeitamente!`;

            await msg.reply(statusInfo);
        }

        // Comando de ajuda
        else if (msg.body.toLowerCase() === '!help' || msg.body.toLowerCase() === '!ajuda') {
            const helpText = `🤖 *Comandos disponíveis:*\n\n` +
                `!ping - Testa se o bot está funcionando\n` +
                `!info - Mostra informações do chat\n` +
                `!status - Status do sistema\n` +
                `!help ou !ajuda - Mostra esta mensagem\n\n` +
                `🖥️ Versão otimizada para macOS\n` +
                `⚡ Desenvolvido com whatsapp-web.js`;

            await msg.reply(helpText);
        }

    } catch (error) {
        console.error('❌ Erro ao processar mensagem:', error.message);
    }
});

// Quando uma mensagem for enviada
client.on('message_create', (msg) => {
    // Esta é uma mensagem que você enviou
    if (msg.fromMe) {
        console.log(`📤 Mensagem enviada para ${msg.to}: ${msg.body}`);
    }
});

// Quando há erro
client.on('disconnected', (reason) => {
    console.log('🔌 Cliente desconectado:', reason);
    console.log('🔄 Tentando reconectar em 5 segundos...');

    setTimeout(() => {
        console.log('🔄 Reiniciando cliente...');
        client.initialize();
    }, 5000);
});

// Eventos de erro
client.on('auth_failure', () => {
    console.log('❌ Falha na autenticação');
});

// Inicializar o cliente
console.log('🔄 Inicializando cliente WhatsApp...');
client.initialize().catch(error => {
    console.error('❌ Erro ao inicializar:', error);
    console.log('💡 Sugestões para resolver:');
    console.log('   1. Feche outras instâncias do Chrome');
    console.log('   2. Remova a pasta .wwebjs_auth');
    console.log('   3. Reinicie o terminal');
    console.log('   4. Tente rodar: sudo xcode-select --install');
});

// Tratamento de sinais para encerramento gracioso
process.on('SIGINT', async () => {
    console.log('🛑 Encerrando cliente...');
    try {
        await client.destroy();
        console.log('✅ Cliente encerrado com sucesso');
    } catch (error) {
        console.log('⚠️ Erro ao encerrar:', error.message);
    }
    process.exit(0);
});

// Tratamento de erros não capturados
process.on('unhandledRejection', (reason, promise) => {
    console.error('❌ Erro não tratado:', reason);
});

process.on('uncaughtException', (error) => {
    console.error('❌ Exceção não capturada:', error);
});
