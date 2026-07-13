const { Client, LocalAuth, MessageMedia } = require('./index');
const qrcode = require('qrcode-terminal');
const fs = require('fs');

// Configurações do bot
const CONFIG = {
    // Prefixo para comandos (pode alterar para ! ou qualquer outro)
    prefix: '!',

    // IDs de admins que podem usar comandos especiais (adicione seus números)
    admins: [
        // '5511999999999@c.us', // Adicione números de admins aqui
    ],

    // Respostas automáticas
    autoReplies: {
        'oi': 'Olá! 👋 Como posso ajudar?',
        'bom dia': 'Bom dia! ☀️ Tenha um ótimo dia!',
        'boa tarde': 'Boa tarde! ⛅ Como está seu dia?',
        'boa noite': 'Boa noite! 🌙 Durma bem!'
    }
};

// Criar cliente com configurações otimizadas
const client = new Client({
    authStrategy: new LocalAuth({
        dataPath: '.wwebjs_auth'
    }),
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

// Função para verificar se é admin
function isAdmin(contactId) {
    return CONFIG.admins.includes(contactId);
}

// Função para log com timestamp
function log(message) {
    const timestamp = new Date().toLocaleString('pt-BR');
    console.log(`[${timestamp}] ${message}`);
}

console.log('🤖 Iniciando Bot WhatsApp Avançado...');

// Eventos do cliente
client.on('qr', (qr) => {
    console.log('📱 Escaneie o QR Code com seu WhatsApp:');
    qrcode.generate(qr, { small: true });
});

client.on('authenticated', () => {
    log('✅ Autenticado com sucesso!');
});

client.on('auth_failure', msg => {
    log(`❌ Falha na autenticação: ${msg}`);
});

client.on('ready', async () => {
    log('🎉 Bot WhatsApp está pronto!');

    // Obter informações do bot
    const info = client.info;
    log(`📱 Conectado como: ${info.pushname} (${info.wid.user})`);

    log('💡 Bot configurado e funcionando!');
});

client.on('message', async msg => {
    try {
        // Ignorar mensagens próprias e de status
        if (msg.fromMe || msg.from === 'status@broadcast') return;

        const chat = await msg.getChat();
        const contact = await msg.getContact();
        const isGroup = chat.isGroup;
        const senderName = contact.name || contact.pushname || msg.from;

        log(`📨 ${isGroup ? `[${chat.name}] ` : ''}${senderName}: ${msg.body}`);

        // Processar comandos
        if (msg.body.startsWith(CONFIG.prefix)) {
            const args = msg.body.slice(CONFIG.prefix.length).trim().split(' ');
            const command = args.shift().toLowerCase();

            await handleCommand(msg, command, args, chat, contact);
        }
        // Respostas automáticas
        else {
            const lowerBody = msg.body.toLowerCase();
            if (CONFIG.autoReplies[lowerBody]) {
                await msg.reply(CONFIG.autoReplies[lowerBody]);
                log(`🤖 Resposta automática enviada para: ${senderName}`);
            }
        }

    } catch (error) {
        log(`❌ Erro ao processar mensagem: ${error.message}`);
    }
});

// Função para processar comandos
async function handleCommand(msg, command, args, chat, contact) {
    const isUserAdmin = isAdmin(contact.id._serialized);

    switch (command) {
        case 'ping':
            await msg.reply('🏓 Pong! Bot está funcionando!');
            break;

        case 'info':
            const info = `ℹ️ *Informações do Chat*\n\n` +
                `👤 Contato: ${contact.name || contact.pushname || 'N/A'}\n` +
                `📱 Número: ${contact.number}\n` +
                `💬 Tipo: ${chat.isGroup ? 'Grupo' : 'Individual'}\n` +
                `🆔 ID: ${chat.id._serialized}\n` +
                `👥 Participantes: ${chat.isGroup ? chat.participants.length : '2'}`;
            await msg.reply(info);
            break;

        case 'help':
        case 'ajuda':
            const helpText = `🤖 *Comandos Disponíveis*\n\n` +
                `${CONFIG.prefix}ping - Testa o bot\n` +
                `${CONFIG.prefix}info - Informações do chat\n` +
                `${CONFIG.prefix}sticker - Cria sticker (responda uma imagem)\n` +
                `${CONFIG.prefix}grupo - Info do grupo (apenas em grupos)\n` +
                `${CONFIG.prefix}clima [cidade] - Consulta clima\n` +
                `${CONFIG.prefix}calc [expressão] - Calculadora\n` +
                `${CONFIG.prefix}help - Esta mensagem\n\n` +
                (isUserAdmin ? `🔧 *Comandos Admin:*\n${CONFIG.prefix}admin - Comandos administrativos\n` : '') +
                `\n🤖 Bot criado com whatsapp-web.js`;
            await msg.reply(helpText);
            break;

        case 'sticker':
            if (msg.hasQuotedMsg) {
                const quotedMsg = await msg.getQuotedMessage();
                if (quotedMsg.hasMedia) {
                    const media = await quotedMsg.downloadMedia();
                    await msg.reply(media, null, { sendMediaAsSticker: true });
                } else {
                    await msg.reply('❌ A mensagem citada deve conter uma imagem!');
                }
            } else {
                await msg.reply('❌ Responda a uma imagem com este comando para criar um sticker!');
            }
            break;

        case 'grupo':
            if (!chat.isGroup) {
                await msg.reply('❌ Este comando só funciona em grupos!');
                break;
            }

            const groupInfo = `👥 *Informações do Grupo*\n\n` +
                `📝 Nome: ${chat.name}\n` +
                `👤 Participantes: ${chat.participants.length}\n` +
                `📱 Criado: ${new Date(chat.createdAt * 1000).toLocaleDateString('pt-BR')}\n` +
                `🔒 Apenas admins podem enviar: ${chat.announce ? 'Sim' : 'Não'}\n` +
                `✏️ Apenas admins podem editar info: ${chat.restrict ? 'Sim' : 'Não'}`;
            await msg.reply(groupInfo);
            break;

        case 'calc':
            if (args.length === 0) {
                await msg.reply('❌ Use: !calc [expressão]\nExemplo: !calc 2 + 2');
                break;
            }

            try {
                const expression = args.join(' ');
                // Segurança básica - apenas números e operadores básicos
                if (!/^[0-9+\-*/(). ]+$/.test(expression)) {
                    await msg.reply('❌ Expressão inválida! Use apenas números e operadores +, -, *, /, ( )');
                    break;
                }

                const result = eval(expression);
                await msg.reply(`🧮 *Calculadora*\n\n📝 Expressão: ${expression}\n✅ Resultado: ${result}`);
            } catch (error) {
                await msg.reply('❌ Erro ao calcular! Verifique a expressão.');
            }
            break;

        case 'admin':
            if (!isUserAdmin) {
                await msg.reply('❌ Você não tem permissão para usar comandos administrativos!');
                break;
            }

            const adminHelp = `🔧 *Comandos Administrativos*\n\n` +
                `${CONFIG.prefix}broadcast [mensagem] - Enviar para todos os chats\n` +
                `${CONFIG.prefix}stats - Estatísticas do bot\n` +
                `${CONFIG.prefix}reload - Reiniciar bot`;
            await msg.reply(adminHelp);
            break;

        case 'stats':
            if (!isUserAdmin) {
                await msg.reply('❌ Comando apenas para administradores!');
                break;
            }

            const chats = await client.getChats();
            const contacts = await client.getContacts();
            const statsText = `📊 *Estatísticas do Bot*\n\n` +
                `💬 Chats ativos: ${chats.length}\n` +
                `👥 Contatos: ${contacts.length}\n` +
                `🕐 Uptime: ${process.uptime().toFixed(0)} segundos\n` +
                `📱 Versão WWeb: ${await client.getWWebVersion()}`;
            await msg.reply(statsText);
            break;

        default:
            await msg.reply(`❌ Comando "${command}" não encontrado!\nUse ${CONFIG.prefix}help para ver comandos disponíveis.`);
    }
}

// Eventos adicionais
client.on('group_join', (notification) => {
    log(`👥 Alguém entrou no grupo: ${notification.chatId}`);
});

client.on('group_leave', (notification) => {
    log(`👥 Alguém saiu do grupo: ${notification.chatId}`);
});

client.on('disconnected', (reason) => {
    log(`🔌 Cliente desconectado: ${reason}`);
});

// Inicializar cliente
client.initialize();

// Encerramento gracioso
process.on('SIGINT', async () => {
    log('🛑 Encerrando bot...');
    await client.destroy();
    process.exit(0);
});

process.on('unhandledRejection', (reason, promise) => {
    log(`❌ Erro não tratado: ${reason}`);
});
