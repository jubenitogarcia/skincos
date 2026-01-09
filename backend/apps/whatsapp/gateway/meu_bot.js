const { Client, LocalAuth } = require('./index');
const qrcode = require('qrcode-terminal');

// Criar o cliente WhatsApp com autenticação local (salva a sessão automaticamente)
const client = new Client({
    authStrategy: new LocalAuth(),
    puppeteer: {
        headless: false, // Manter false para ver o navegador (útil para debug)
        timeout: 60000, // Aumentar timeout para 60 segundos
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-accelerated-2d-canvas',
            '--no-first-run',
            '--no-zygote',
            '--disable-gpu',
            '--disable-web-security',
            '--disable-features=VizDisplayCompositor'
        ],
        executablePath: process.platform === 'darwin' ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' : undefined
    }
});

console.log('🚀 Iniciando cliente WhatsApp...');

// Quando um QR Code for gerado
client.on('qr', (qr) => {
    console.log('📱 QR Code recebido! Escaneie com seu WhatsApp:');
    qrcode.generate(qr, { small: true });
});

// Quando a autenticação for bem-sucedida
client.on('authenticated', () => {
    console.log('✅ Autenticado com sucesso!');
});

// Quando houver falha na autenticação
client.on('auth_failure', msg => {
    console.error('❌ Falha na autenticação:', msg);
});

// Quando o cliente estiver pronto
client.on('ready', () => {
    console.log('🎉 Cliente WhatsApp está pronto!');
    console.log('💡 Envie "!ping" para qualquer chat para testar');
});

// Quando receber uma mensagem
client.on('message', async msg => {
    console.log(`📨 Mensagem recebida de ${msg.from}: ${msg.body}`);

    // Comando ping
    if (msg.body.toLowerCase() === '!ping') {
        await msg.reply('🏓 Pong!');
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
        info += `👥 É grupo: ${chat.isGroup ? 'Sim' : 'Não'}`;

        await msg.reply(info);
    }

    // Comando de ajuda
    else if (msg.body.toLowerCase() === '!help' || msg.body.toLowerCase() === '!ajuda') {
        const helpText = `🤖 *Comandos disponíveis:*\n\n` +
            `!ping - Testa se o bot está funcionando\n` +
            `!info - Mostra informações do chat\n` +
            `!help ou !ajuda - Mostra esta mensagem`;

        await msg.reply(helpText);
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
});

// Inicializar o cliente
client.initialize();

// Tratamento de sinais para encerramento gracioso
process.on('SIGINT', async () => {
    console.log('🛑 Encerrando cliente...');
    await client.destroy();
    process.exit(0);
});
