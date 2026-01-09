const { Client, LocalAuth } = require('./index');
const qrcode = require('qrcode-terminal');
const express = require('express');
const cors = require('cors');

// Configuração do servidor Express
const app = express();
const PORT = 3001;

// Middlewares
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Variáveis de controle
let isClientReady = false;
let qrCodeData = null;
let lastError = null;
let client = null;
let clientInfo = null;

console.log('🚀 Iniciando Bot WhatsApp - Versão Estável para macOS...');
console.log('');
console.log('📋 INFORMAÇÕES IMPORTANTES:');
console.log('   🖥️ VS Code pode ser fechado - o bot continuará rodando');
console.log('   🌐 Chrome/WhatsApp Web DEVE permanecer aberto (pode minimizar)');
console.log('   📱 Se fechar o Chrome, o bot parará de funcionar');
console.log('   🔧 Use os scripts de controle para gerenciar o bot');
console.log('');

// Função para criar cliente com configuração otimizada
function createClient() {
    try {
        client = new Client({
            authStrategy: new LocalAuth({
                dataPath: './.wwebjs_auth',
                clientId: 'macos-client'
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
                    '--disable-gpu',
                    '--disable-extensions',
                    '--disable-background-timer-throttling',
                    '--disable-backgrounding-occluded-windows',
                    '--disable-renderer-backgrounding',
                    '--disable-features=TranslateUI',
                    '--disable-ipc-flooding-protection'
                ],
                timeout: 120000,
                ignoreDefaultArgs: ['--disable-extensions']
            }
        });

        setupClientEvents();
        return client;
    } catch (error) {
        console.error('❌ Erro ao criar cliente:', error);
        lastError = error.message;
        return null;
    }
}

// Configurar eventos do cliente
function setupClientEvents() {
    if (!client) return;

    client.on('qr', (qr) => {
        console.log('📱 QR Code recebido! Escaneie com seu WhatsApp:');
        qrcode.generate(qr, { small: true });
        qrCodeData = qr;
        isClientReady = false;
        lastError = null;
    });

    client.on('authenticated', () => {
        console.log('✅ Autenticado com sucesso!');
        qrCodeData = null;
        lastError = null;
    });

    client.on('auth_failure', msg => {
        console.error('❌ Falha na autenticação:', msg);
        lastError = `Falha na autenticação: ${msg}`;
        isClientReady = false;
    });

    client.on('ready', async () => {
        console.log('🎉 Cliente WhatsApp está pronto!');
        console.log('💡 Envie "!ping" para qualquer chat para testar');
        console.log('');
        console.log('✅ SISTEMA OPERACIONAL:');
        console.log('   🖥️ VS Code: Pode ser fechado');
        console.log('   🌐 Chrome: DEVE permanecer aberto');
        console.log('   📱 Interface: http://localhost:3001');
        console.log('');
        isClientReady = true;
        lastError = null;

        try {
            clientInfo = await client.info;
            console.log(`📱 Conectado como: ${clientInfo.pushname} (${clientInfo.wid.user})`);
            console.log(`🌐 Versão WhatsApp Web: ${clientInfo.version}`);
        } catch (err) {
            console.log('⚠️ Não foi possível obter informações do usuário');
            clientInfo = { pushname: 'Usuário', wid: { user: 'conectado' }, version: 'N/A' };
        }
    });

    client.on('disconnected', (reason) => {
        console.log('❌ Cliente desconectado:', reason);
        isClientReady = false;
        lastError = `Desconectado: ${reason}`;
        clientInfo = null;

        // Tentar reconectar após 5 segundos
        setTimeout(() => {
            console.log('🔄 Tentando reconectar...');
            initializeClient();
        }, 5000);
    });

    // Handler de mensagens
    client.on('message', async msg => {
        try {
            console.log(`📨 Mensagem recebida de ${msg.from}: ${msg.body}`);

            if (msg.body === '!ping') {
                await msg.reply('🏓 Pong! Bot está funcionando perfeitamente!');
            } else if (msg.body === '!info') {
                const info = clientInfo || await client.info;
                await msg.reply(`ℹ️ Bot Info:
📱 ${info.pushname}
🌐 ${info.version}
🖥️ Servidor: macOS optimized
⏰ ${new Date().toLocaleString('pt-BR')}`);
            } else if (msg.body === '!help') {
                await msg.reply(`🤖 Comandos disponíveis:
!ping - Teste de conectividade
!info - Informações do bot
!help - Lista de comandos
!status - Status detalhado`);
            } else if (msg.body === '!status') {
                await msg.reply(`📊 Status do Sistema:
✅ Bot: Conectado
🌐 API: http://localhost:3001
📱 WhatsApp: Ativo
🖥️ Sistema: macOS`);
            }
        } catch (error) {
            console.error('❌ Erro ao processar mensagem:', error);
        }
    });
}

// Função para inicializar cliente com retry
async function initializeClient() {
    try {
        if (client) {
            await client.destroy().catch(() => { });
        }

        client = createClient();
        if (client) {
            await client.initialize();
        }
    } catch (error) {
        console.error('❌ Erro ao inicializar cliente:', error);
        lastError = error.message;

        // Tentar novamente em 10 segundos
        setTimeout(() => {
            console.log('🔄 Tentando inicializar novamente...');
            initializeClient();
        }, 10000);
    }
}

// ========================================
// ROTAS DA API
// ========================================

// Página inicial com interface web
app.get('/', (req, res) => {
    res.send(`
    <!DOCTYPE html>
    <html lang="pt-BR">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>WhatsApp Bot - macOS Estável</title>
        <style>
            body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Arial, sans-serif; margin: 20px; background: linear-gradient(135deg, #25D366 0%, #128C7E 100%); min-height: 100vh; }
            .container { max-width: 1200px; margin: 0 auto; background: white; padding: 30px; border-radius: 15px; box-shadow: 0 10px 30px rgba(0,0,0,0.2); }
            .header { text-align: center; margin-bottom: 30px; }
            .header h1 { color: #25D366; margin: 0; font-size: 2.5em; }
            .header p { color: #666; margin: 10px 0; }
            .badge { display: inline-block; background: #25D366; color: white; padding: 5px 15px; border-radius: 20px; font-size: 0.9em; margin: 5px; }
            .section { margin: 25px 0; padding: 20px; border: 1px solid #e0e0e0; border-radius: 10px; background: #fafafa; }
            .section h2 { color: #128C7E; margin-top: 0; }
            .endpoint { background: white; padding: 15px; margin: 15px 0; border-left: 4px solid #25D366; border-radius: 5px; box-shadow: 0 2px 5px rgba(0,0,0,0.1); }
            .status { padding: 15px; border-radius: 10px; margin: 15px 0; font-weight: bold; }
            .ready { background: #d4edda; color: #155724; border: 2px solid #c3e6cb; }
            .waiting { background: #fff3cd; color: #856404; border: 2px solid #ffeaa7; }
            .error { background: #f8d7da; color: #721c24; border: 2px solid #f5c6cb; }
            code { background: #f4f4f4; padding: 5px 8px; border-radius: 5px; font-family: 'Monaco', 'Courier New', monospace; }
            .form-group { margin: 20px 0; }
            label { display: block; margin-bottom: 8px; font-weight: bold; color: #333; }
            input, textarea { width: 100%; padding: 12px; border: 2px solid #ddd; border-radius: 8px; font-size: 16px; }
            input:focus, textarea:focus { outline: none; border-color: #25D366; }
            button { background: linear-gradient(135deg, #25D366 0%, #128C7E 100%); color: white; padding: 12px 25px; border: none; border-radius: 8px; cursor: pointer; font-size: 16px; font-weight: bold; transition: transform 0.2s; }
            button:hover { transform: translateY(-2px); box-shadow: 0 5px 15px rgba(37, 211, 102, 0.4); }
            .refresh { float: right; background: #007bff; }
            .stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 15px; margin: 20px 0; }
            .stat-card { background: white; padding: 20px; border-radius: 10px; text-align: center; box-shadow: 0 3px 10px rgba(0,0,0,0.1); }
            .stat-number { font-size: 2em; font-weight: bold; color: #25D366; }
            .stat-label { color: #666; margin-top: 5px; }
        </style>
    </head>
    <body>
        <div class="container">
            <div class="header">
                <h1>🚀 WhatsApp Bot API</h1>
                <p>Versão Estável e Otimizada para macOS</p>
                <div>
                    <span class="badge">✅ Express Server</span>
                    <span class="badge">🖥️ macOS Optimized</span>
                    <span class="badge">🔄 Auto-Reconnect</span>
                </div>
                <button class="refresh" onclick="location.reload()">🔄 Atualizar</button>
            </div>

            <div class="section">
                <h2>📊 Status do Sistema</h2>
                <div class="status waiting" id="status">
                    ⏳ Verificando status do WhatsApp...
                </div>

                <div class="stats">
                    <div class="stat-card">
                        <div class="stat-number" id="uptime">--</div>
                        <div class="stat-label">Tempo Online</div>
                    </div>
                    <div class="stat-card">
                        <div class="stat-number" id="messages">--</div>
                        <div class="stat-label">Mensagens</div>
                    </div>
                    <div class="stat-card">
                        <div class="stat-number" id="chats">--</div>
                        <div class="stat-label">Chats</div>
                    </div>
                </div>
            </div>

            <div class="section">
                <h2>🌐 Endpoints da API</h2>
                <div class="endpoint">
                    <strong>📊 Status:</strong> <code>GET /status</code><br>
                    Verificar status detalhado do bot e conexão
                </div>
                <div class="endpoint">
                    <strong>📱 Enviar:</strong> <code>POST /send</code><br>
                    Enviar mensagens programaticamente
                </div>
                <div class="endpoint">
                    <strong>💬 Chats:</strong> <code>GET /chats</code><br>
                    Listar conversas ativas
                </div>
                <div class="endpoint">
                    <strong>📋 Info:</strong> <code>GET /info</code><br>
                    Informações do usuário conectado
                </div>
            </div>

            <div class="section">
                <h2>🧪 Teste de Envio</h2>
                <div class="form-group">
                    <label for="phone">📞 Número (com código do país):</label>
                    <input type="text" id="phone" placeholder="+5551995103563" value="+5551995103563">
                </div>
                <div class="form-group">
                    <label for="message">💬 Mensagem:</label>
                    <textarea id="message" rows="4" placeholder="Digite sua mensagem...">🤖 Teste via interface web - Bot macOS funcionando perfeitamente! ✅</textarea>
                </div>
                <button onclick="sendMessage()">📱 Enviar Mensagem</button>
                <div id="result" style="margin-top: 20px;"></div>
            </div>
        </div>

        <script>
            let startTime = Date.now();

            async function sendMessage() {
                const phone = document.getElementById('phone').value;
                const message = document.getElementById('message').value;
                const result = document.getElementById('result');

                if (!phone || !message) {
                    result.innerHTML = '<div class="status error">❌ Preencha todos os campos</div>';
                    return;
                }

                try {
                    result.innerHTML = '<div class="status waiting">⏳ Enviando mensagem...</div>';

                    const response = await fetch('/send', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ phone, message })
                    });

                    const data = await response.json();

                    if (response.ok) {
                        result.innerHTML = '<div class="status ready">✅ ' + data.message + '</div>';
                    } else {
                        result.innerHTML = '<div class="status error">❌ ' + (data.error || 'Erro desconhecido') + '</div>';
                    }
                } catch (error) {
                    result.innerHTML = '<div class="status error">❌ Erro: ' + error.message + '</div>';
                }
            }

            // Atualizar status e estatísticas
            setInterval(async () => {
                try {
                    const response = await fetch('/status');
                    const data = await response.json();
                    const statusDiv = document.getElementById('status');

                    if (data.ready) {
                        statusDiv.className = 'status ready';
                        statusDiv.innerHTML = '✅ WhatsApp conectado: ' + (data.user || 'Usuário ativo');
                    } else if (data.qr) {
                        statusDiv.className = 'status waiting';
                        statusDiv.innerHTML = '📱 QR Code disponível - Escaneie com WhatsApp no celular';
                    } else if (data.error) {
                        statusDiv.className = 'status error';
                        statusDiv.innerHTML = '❌ ' + data.error;
                    } else {
                        statusDiv.className = 'status waiting';
                        statusDiv.innerHTML = '⏳ Inicializando WhatsApp...';
                    }

                    // Atualizar estatísticas
                    const uptime = Math.floor((Date.now() - startTime) / 1000);
                    document.getElementById('uptime').textContent = uptime + 's';
                    document.getElementById('messages').textContent = data.messageCount || '--';
                    document.getElementById('chats').textContent = data.chatCount || '--';

                } catch (error) {
                    console.log('Status check failed:', error);
                }
            }, 2000);
        </script>
    </body>
    </html>
    `);
});

// Status da API
app.get('/status', async (req, res) => {
    try {
        let userInfo = null;
        let messageCount = 0;
        let chatCount = 0;

        if (isClientReady && client) {
            try {
                if (clientInfo) {
                    userInfo = `${clientInfo.pushname} (${clientInfo.wid.user})`;
                } else {
                    const info = await client.info;
                    userInfo = `${info.pushname} (${info.wid.user})`;
                    clientInfo = info;
                }

                // Tentar obter estatísticas
                const chats = await client.getChats();
                chatCount = chats.length;

            } catch (err) {
                userInfo = 'Conectado';
            }
        }

        res.json({
            ready: isClientReady,
            qr: qrCodeData !== null,
            user: userInfo,
            error: lastError,
            messageCount,
            chatCount,
            timestamp: new Date().toISOString(),
            version: '2.0-macos-stable'
        });
    } catch (error) {
        res.status(500).json({
            ready: false,
            error: error.message,
            timestamp: new Date().toISOString()
        });
    }
});

// Endpoint /health para Agent-Zero
app.get('/health', async (req, res) => {
    try {
        const status = isClientReady ? 'READY' : 'NOT_READY';

        res.json({
            status: status,
            ready: isClientReady,
            service: 'WhatsApp Bot API',
            timestamp: new Date().toISOString(),
            uptime: process.uptime(),
            version: '2.0-macos-stable'
        });
    } catch (error) {
        res.status(500).json({
            status: 'ERROR',
            ready: false,
            error: error.message,
            timestamp: new Date().toISOString()
        });
    }
});// Informações do usuário
app.get('/info', async (req, res) => {
    try {
        if (!isClientReady) {
            return res.status(503).json({
                success: false,
                error: 'WhatsApp não está conectado'
            });
        }

        const info = clientInfo || await client.info;
        res.json({
            success: true,
            info: {
                name: info.pushname,
                phone: info.wid.user,
                version: info.version,
                platform: info.platform || 'web'
            }
        });

    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Enviar mensagem
app.post('/send', async (req, res) => {
    try {
        const { phone, groupId, message } = req.body;

        if (!message) {
            return res.status(400).json({
                success: false,
                error: 'Parâmetro "message" é obrigatório'
            });
        }

        if (!phone && !groupId) {
            return res.status(400).json({
                success: false,
                error: 'É necessário informar "phone" para contato individual ou "groupId" para grupo'
            });
        }

        if (!isClientReady) {
            return res.status(503).json({
                success: false,
                error: 'WhatsApp não está conectado. Verifique o status.'
            });
        }

        let targetId;
        let targetDescription;

        if (groupId) {
            // Envio para grupo
            targetId = groupId;
            targetDescription = `grupo ${groupId}`;

            // Verificar se o grupo existe
            try {
                const chat = await client.getChatById(groupId);
                if (!chat.isGroup) {
                    return res.status(400).json({
                        success: false,
                        error: 'ID fornecido não é de um grupo'
                    });
                }
                targetDescription = `grupo "${chat.name}" (${groupId})`;
            } catch (error) {
                return res.status(404).json({
                    success: false,
                    error: `Grupo não encontrado: ${groupId}`
                });
            }
        } else {
            // Envio para contato individual
            const cleanPhone = phone.replace(/[^\d]/g, '');
            targetId = cleanPhone + '@c.us';
            targetDescription = phone;
        }

        // Enviar mensagem
        await client.sendMessage(targetId, message);

        console.log(`✅ Mensagem enviada para ${targetDescription}: "${message}"`);

        res.json({
            success: true,
            message: `Mensagem enviada para ${targetDescription} com sucesso!`,
            timestamp: new Date().toISOString(),
            target: targetDescription
        });

    } catch (error) {
        console.error('❌ Erro ao enviar mensagem:', error);
        res.status(500).json({
            success: false,
            error: `Erro ao enviar: ${error.message}`
        });
    }
});

// Listar chats
app.get('/chats', async (req, res) => {
    try {
        if (!isClientReady) {
            return res.status(200).json({ success: false, chats: [], total: 0, reason: 'not-ready' });
        }

        const chats = await client.getChats();
        const chatList = chats.slice(0, 20).map(chat => ({
            id: chat?.id?._serialized,
            name: chat?.name || 'Chat sem nome',
            isGroup: !!chat?.isGroup,
            unreadCount: Number(chat?.unreadCount || 0),
            lastMessage: chat?.lastMessage ? {
                body: String(chat.lastMessage.body || '').slice(0, 200),
                timestamp: chat.lastMessage.timestamp
            } : null
        }));

        return res.json({ success: true, chats: chatList, total: chats.length });

    } catch (error) {
        console.error('❌ Erro ao listar chats:', error);
        return res.status(200).json({ success: false, chats: [], total: 0, reason: 'exception', error: String(error?.message || error) });
    }
});

// Alias compatível para adaptadores que tentam /v1/conversations
app.get('/v1/conversations', async (req, res) => {
    try {
        if (!isClientReady) {
            return res.status(200).json({ success: false, chats: [], total: 0, reason: 'not-ready' });
        }
        const chats = await client.getChats();
        const chatList = chats.slice(0, 50).map(chat => ({
            id: chat?.id?._serialized,
            name: chat?.name || 'Chat sem nome',
            isGroup: !!chat?.isGroup,
            unreadCount: Number(chat?.unreadCount || 0),
            lastMessage: chat?.lastMessage ? {
                body: String(chat.lastMessage.body || '').slice(0, 200),
                timestamp: chat.lastMessage.timestamp
            } : null
        }));
        return res.json({ success: true, chats: chatList, total: chats.length });
    } catch (error) {
        console.error('❌ Erro em /v1/conversations:', error);
        return res.status(200).json({ success: false, chats: [], total: 0, reason: 'exception', error: String(error?.message || error) });
    }
});

// Listar apenas grupos
app.get('/groups', async (req, res) => {
    try {
        if (!isClientReady) {
            return res.status(503).json({
                success: false,
                error: 'WhatsApp não está conectado'
            });
        }

        const chats = await client.getChats();
        const groups = chats.filter(chat => chat.isGroup).map(group => ({
            id: group.id._serialized,
            name: group.name || 'Grupo sem nome',
            participantCount: group.participants ? group.participants.length : 0,
            unreadCount: group.unreadCount,
            lastMessage: group.lastMessage ? {
                body: group.lastMessage.body.substring(0, 50) + '...',
                timestamp: group.lastMessage.timestamp,
                author: group.lastMessage.author
            } : null
        }));

        res.json({
            success: true,
            groups: groups,
            total: groups.length,
            timestamp: new Date().toISOString()
        });

    } catch (error) {
        console.error('❌ Erro ao listar grupos:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// ========================================
// FUNCIONALIDADES DE MÍDIA E STICKERS
// ========================================

// Enviar mídia (imagem, vídeo, documento, áudio)
app.post('/send-media', async (req, res) => {
    try {
        const { phone, groupId, mediaUrl, mediaPath, caption, filename, mimetype } = req.body;

        if (!phone && !groupId) {
            return res.status(400).json({
                success: false,
                error: 'É necessário informar "phone" ou "groupId"'
            });
        }

        if (!mediaUrl && !mediaPath) {
            return res.status(400).json({
                success: false,
                error: 'É necessário informar "mediaUrl" ou "mediaPath"'
            });
        }

        if (!isClientReady) {
            return res.status(503).json({
                success: false,
                error: 'WhatsApp não está conectado'
            });
        }

        let targetId = groupId || (phone.replace(/[^\d]/g, '') + '@c.us');

        // Importar MessageMedia
        const { MessageMedia } = require('./index');
        let media;

        if (mediaUrl) {
            media = await MessageMedia.fromUrl(mediaUrl);
        } else {
            media = MessageMedia.fromFilePath(mediaPath);
        }

        if (filename) media.filename = filename;
        if (mimetype) media.mimetype = mimetype;

        await client.sendMessage(targetId, media, { caption: caption || '' });

        res.json({
            success: true,
            message: 'Mídia enviada com sucesso!',
            timestamp: new Date().toISOString()
        });

    } catch (error) {
        console.error('❌ Erro ao enviar mídia:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Enviar localização
app.post('/send-location', async (req, res) => {
    try {
        const { phone, groupId, latitude, longitude, name, address } = req.body;

        if (!phone && !groupId) {
            return res.status(400).json({
                success: false,
                error: 'É necessário informar "phone" ou "groupId"'
            });
        }

        if (!latitude || !longitude) {
            return res.status(400).json({
                success: false,
                error: 'É necessário informar "latitude" e "longitude"'
            });
        }

        if (!isClientReady) {
            return res.status(503).json({
                success: false,
                error: 'WhatsApp não está conectado'
            });
        }

        let targetId = groupId || (phone.replace(/[^\d]/g, '') + '@c.us');

        const { Location } = require('./index');
        const location = new Location(latitude, longitude, { name, address });

        await client.sendMessage(targetId, location);

        res.json({
            success: true,
            message: 'Localização enviada com sucesso!',
            timestamp: new Date().toISOString()
        });

    } catch (error) {
        console.error('❌ Erro ao enviar localização:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Enviar contato
app.post('/send-contact', async (req, res) => {
    try {
        const { phone, groupId, contactPhone } = req.body;

        if (!phone && !groupId) {
            return res.status(400).json({
                success: false,
                error: 'É necessário informar "phone" ou "groupId"'
            });
        }

        if (!contactPhone) {
            return res.status(400).json({
                success: false,
                error: 'É necessário informar "contactPhone"'
            });
        }

        if (!isClientReady) {
            return res.status(503).json({
                success: false,
                error: 'WhatsApp não está conectado'
            });
        }

        let targetId = groupId || (phone.replace(/[^\d]/g, '') + '@c.us');
        const contactId = contactPhone.replace(/[^\d]/g, '') + '@c.us';

        const contact = await client.getContactById(contactId);
        await client.sendMessage(targetId, contact);

        res.json({
            success: true,
            message: 'Contato enviado com sucesso!',
            timestamp: new Date().toISOString()
        });

    } catch (error) {
        console.error('❌ Erro ao enviar contato:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Criar enquete/poll
app.post('/send-poll', async (req, res) => {
    try {
        const { phone, groupId, question, options, allowMultipleAnswers = false } = req.body;

        if (!phone && !groupId) {
            return res.status(400).json({
                success: false,
                error: 'É necessário informar "phone" ou "groupId"'
            });
        }

        if (!question || !options || !Array.isArray(options) || options.length < 2) {
            return res.status(400).json({
                success: false,
                error: 'É necessário informar "question" e pelo menos 2 "options"'
            });
        }

        if (!isClientReady) {
            return res.status(503).json({
                success: false,
                error: 'WhatsApp não está conectado'
            });
        }

        let targetId = groupId || (phone.replace(/[^\d]/g, '') + '@c.us');

        const { Poll } = require('./index');
        const poll = new Poll(question, options, { allowMultipleAnswers });

        await client.sendMessage(targetId, poll);

        res.json({
            success: true,
            message: 'Enquete criada com sucesso!',
            timestamp: new Date().toISOString()
        });

    } catch (error) {
        console.error('❌ Erro ao criar enquete:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// ========================================
// GERENCIAMENTO DE CONTATOS
// ========================================

// Listar contatos
app.get('/contacts', async (req, res) => {
    try {
        if (!isClientReady) {
            return res.status(503).json({
                success: false,
                error: 'WhatsApp não está conectado'
            });
        }

        const contacts = await client.getContacts();
        const contactList = contacts.slice(0, 50).map(contact => ({
            id: contact.id._serialized,
            name: contact.name || contact.pushname || 'Sem nome',
            number: contact.number,
            isMyContact: contact.isMyContact,
            isBlocked: contact.isBlocked,
            isBusiness: contact.isBusiness
        }));

        res.json({
            success: true,
            contacts: contactList,
            total: contacts.length,
            timestamp: new Date().toISOString()
        });

    } catch (error) {
        console.error('❌ Erro ao listar contatos:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Bloquear contato
app.post('/block-contact', async (req, res) => {
    try {
        const { phone } = req.body;

        if (!phone) {
            return res.status(400).json({
                success: false,
                error: 'É necessário informar "phone"'
            });
        }

        if (!isClientReady) {
            return res.status(503).json({
                success: false,
                error: 'WhatsApp não está conectado'
            });
        }

        const contactId = phone.replace(/[^\d]/g, '') + '@c.us';
        const contact = await client.getContactById(contactId);
        await contact.block();

        res.json({
            success: true,
            message: 'Contato bloqueado com sucesso!',
            timestamp: new Date().toISOString()
        });

    } catch (error) {
        console.error('❌ Erro ao bloquear contato:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Desbloquear contato
app.post('/unblock-contact', async (req, res) => {
    try {
        const { phone } = req.body;

        if (!phone) {
            return res.status(400).json({
                success: false,
                error: 'É necessário informar "phone"'
            });
        }

        if (!isClientReady) {
            return res.status(503).json({
                success: false,
                error: 'WhatsApp não está conectado'
            });
        }

        const contactId = phone.replace(/[^\d]/g, '') + '@c.us';
        const contact = await client.getContactById(contactId);
        await contact.unblock();

        res.json({
            success: true,
            message: 'Contato desbloqueado com sucesso!',
            timestamp: new Date().toISOString()
        });

    } catch (error) {
        console.error('❌ Erro ao desbloquear contato:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// ========================================
// GERENCIAMENTO DE GRUPOS
// ========================================

// Criar grupo
app.post('/create-group', async (req, res) => {
    try {
        const { name, participants } = req.body;

        if (!name) {
            return res.status(400).json({
                success: false,
                error: 'É necessário informar "name"'
            });
        }

        if (!participants || !Array.isArray(participants) || participants.length < 1) {
            return res.status(400).json({
                success: false,
                error: 'É necessário informar pelo menos 1 participante'
            });
        }

        if (!isClientReady) {
            return res.status(503).json({
                success: false,
                error: 'WhatsApp não está conectado'
            });
        }

        const participantIds = participants.map(phone => phone.replace(/[^\d]/g, '') + '@c.us');
        const group = await client.createGroup(name, participantIds);

        res.json({
            success: true,
            message: 'Grupo criado com sucesso!',
            groupId: group.gid._serialized,
            timestamp: new Date().toISOString()
        });

    } catch (error) {
        console.error('❌ Erro ao criar grupo:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Adicionar participantes ao grupo
app.post('/add-participants', async (req, res) => {
    try {
        const { groupId, participants } = req.body;

        if (!groupId) {
            return res.status(400).json({
                success: false,
                error: 'É necessário informar "groupId"'
            });
        }

        if (!participants || !Array.isArray(participants)) {
            return res.status(400).json({
                success: false,
                error: 'É necessário informar "participants"'
            });
        }

        if (!isClientReady) {
            return res.status(503).json({
                success: false,
                error: 'WhatsApp não está conectado'
            });
        }

        const chat = await client.getChatById(groupId);
        const participantIds = participants.map(phone => phone.replace(/[^\d]/g, '') + '@c.us');

        await chat.addParticipants(participantIds);

        res.json({
            success: true,
            message: 'Participantes adicionados com sucesso!',
            timestamp: new Date().toISOString()
        });

    } catch (error) {
        console.error('❌ Erro ao adicionar participantes:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Remover participantes do grupo
app.post('/remove-participants', async (req, res) => {
    try {
        const { groupId, participants } = req.body;

        if (!groupId) {
            return res.status(400).json({
                success: false,
                error: 'É necessário informar "groupId"'
            });
        }

        if (!participants || !Array.isArray(participants)) {
            return res.status(400).json({
                success: false,
                error: 'É necessário informar "participants"'
            });
        }

        if (!isClientReady) {
            return res.status(503).json({
                success: false,
                error: 'WhatsApp não está conectado'
            });
        }

        const chat = await client.getChatById(groupId);
        const participantIds = participants.map(phone => phone.replace(/[^\d]/g, '') + '@c.us');

        await chat.removeParticipants(participantIds);

        res.json({
            success: true,
            message: 'Participantes removidos com sucesso!',
            timestamp: new Date().toISOString()
        });

    } catch (error) {
        console.error('❌ Erro ao remover participantes:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Promover participantes a admin
app.post('/promote-participants', async (req, res) => {
    try {
        const { groupId, participants } = req.body;

        if (!groupId) {
            return res.status(400).json({
                success: false,
                error: 'É necessário informar "groupId"'
            });
        }

        if (!participants || !Array.isArray(participants)) {
            return res.status(400).json({
                success: false,
                error: 'É necessário informar "participants"'
            });
        }

        if (!isClientReady) {
            return res.status(503).json({
                success: false,
                error: 'WhatsApp não está conectado'
            });
        }

        const chat = await client.getChatById(groupId);
        const participantIds = participants.map(phone => phone.replace(/[^\d]/g, '') + '@c.us');

        await chat.promoteParticipants(participantIds);

        res.json({
            success: true,
            message: 'Participantes promovidos a admin com sucesso!',
            timestamp: new Date().toISOString()
        });

    } catch (error) {
        console.error('❌ Erro ao promover participantes:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Rebaixar admins
app.post('/demote-participants', async (req, res) => {
    try {
        const { groupId, participants } = req.body;

        if (!groupId) {
            return res.status(400).json({
                success: false,
                error: 'É necessário informar "groupId"'
            });
        }

        if (!participants || !Array.isArray(participants)) {
            return res.status(400).json({
                success: false,
                error: 'É necessário informar "participants"'
            });
        }

        if (!isClientReady) {
            return res.status(503).json({
                success: false,
                error: 'WhatsApp não está conectado'
            });
        }

        const chat = await client.getChatById(groupId);
        const participantIds = participants.map(phone => phone.replace(/[^\d]/g, '') + '@c.us');

        await chat.demoteParticipants(participantIds);

        res.json({
            success: true,
            message: 'Admins rebaixados com sucesso!',
            timestamp: new Date().toISOString()
        });

    } catch (error) {
        console.error('❌ Erro ao rebaixar admins:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Obter link de convite do grupo
app.get('/group-invite/:groupId', async (req, res) => {
    try {
        const { groupId } = req.params;

        if (!isClientReady) {
            return res.status(503).json({
                success: false,
                error: 'WhatsApp não está conectado'
            });
        }

        const chat = await client.getChatById(groupId);
        const inviteCode = await chat.getInviteCode();

        res.json({
            success: true,
            inviteLink: `https://chat.whatsapp.com/${inviteCode}`,
            inviteCode: inviteCode,
            timestamp: new Date().toISOString()
        });

    } catch (error) {
        console.error('❌ Erro ao obter link de convite:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Revogar link de convite do grupo
app.post('/revoke-group-invite', async (req, res) => {
    try {
        const { groupId } = req.body;

        if (!groupId) {
            return res.status(400).json({
                success: false,
                error: 'É necessário informar "groupId"'
            });
        }

        if (!isClientReady) {
            return res.status(503).json({
                success: false,
                error: 'WhatsApp não está conectado'
            });
        }

        const chat = await client.getChatById(groupId);
        await chat.revokeInvite();

        res.json({
            success: true,
            message: 'Link de convite revogado com sucesso!',
            timestamp: new Date().toISOString()
        });

    } catch (error) {
        console.error('❌ Erro ao revogar link de convite:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// ========================================
// FUNCIONALIDADES AVANÇADAS
// ========================================

// Marcar mensagem como visualizada
app.post('/mark-seen', async (req, res) => {
    try {
        const { chatId } = req.body;

        if (!chatId) {
            return res.status(400).json({
                success: false,
                error: 'É necessário informar "chatId"'
            });
        }

        if (!isClientReady) {
            return res.status(503).json({
                success: false,
                error: 'WhatsApp não está conectado'
            });
        }

        await client.sendSeen(chatId);

        res.json({
            success: true,
            message: 'Chat marcado como visualizado!',
            timestamp: new Date().toISOString()
        });

    } catch (error) {
        console.error('❌ Erro ao marcar como visualizado:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Silenciar chat
app.post('/mute-chat', async (req, res) => {
    try {
        const { chatId, duration } = req.body; // duration em milissegundos

        if (!chatId) {
            return res.status(400).json({
                success: false,
                error: 'É necessário informar "chatId"'
            });
        }

        if (!isClientReady) {
            return res.status(503).json({
                success: false,
                error: 'WhatsApp não está conectado'
            });
        }

        const unmuteDate = duration ? new Date(Date.now() + duration) : null;
        await client.muteChat(chatId, unmuteDate);

        res.json({
            success: true,
            message: duration ? `Chat silenciado por ${duration}ms` : 'Chat silenciado indefinidamente',
            timestamp: new Date().toISOString()
        });

    } catch (error) {
        console.error('❌ Erro ao silenciar chat:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Reativar som do chat
app.post('/unmute-chat', async (req, res) => {
    try {
        const { chatId } = req.body;

        if (!chatId) {
            return res.status(400).json({
                success: false,
                error: 'É necessário informar "chatId"'
            });
        }

        if (!isClientReady) {
            return res.status(503).json({
                success: false,
                error: 'WhatsApp não está conectado'
            });
        }

        await client.unmuteChat(chatId);

        res.json({
            success: true,
            message: 'Som do chat reativado!',
            timestamp: new Date().toISOString()
        });

    } catch (error) {
        console.error('❌ Erro ao reativar som do chat:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Definir status/recado
app.post('/set-status', async (req, res) => {
    try {
        const { status } = req.body;

        if (!status) {
            return res.status(400).json({
                success: false,
                error: 'É necessário informar "status"'
            });
        }

        if (!isClientReady) {
            return res.status(503).json({
                success: false,
                error: 'WhatsApp não está conectado'
            });
        }

        await client.setStatus(status);

        res.json({
            success: true,
            message: 'Status definido com sucesso!',
            timestamp: new Date().toISOString()
        });

    } catch (error) {
        console.error('❌ Erro ao definir status:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Verificar se número está no WhatsApp
app.get('/check-number/:phone', async (req, res) => {
    try {
        const { phone } = req.params;

        if (!isClientReady) {
            return res.status(503).json({
                success: false,
                error: 'WhatsApp não está conectado'
            });
        }

        const cleanPhone = phone.replace(/[^\d]/g, '');
        const numberId = await client.getNumberId(cleanPhone);

        res.json({
            success: true,
            phone: phone,
            cleanPhone: cleanPhone,
            hasWhatsApp: !!numberId,
            numberInfo: numberId,
            timestamp: new Date().toISOString()
        });

    } catch (error) {
        console.error('❌ Erro ao verificar número:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Buscar mensagens
app.post('/search-messages', async (req, res) => {
    try {
        const { query, chatId, limit = 20 } = req.body;

        if (!query) {
            return res.status(400).json({
                success: false,
                error: 'É necessário informar "query"'
            });
        }

        if (!isClientReady) {
            return res.status(503).json({
                success: false,
                error: 'WhatsApp não está conectado'
            });
        }

        const options = { limit };
        if (chatId) options.chatId = chatId;

        const messages = await client.searchMessages(query, options);
        const messageList = messages.map(msg => ({
            id: msg.id._serialized,
            body: msg.body,
            from: msg.from,
            to: msg.to,
            timestamp: msg.timestamp,
            hasMedia: msg.hasMedia,
            type: msg.type
        }));

        res.json({
            success: true,
            messages: messageList,
            total: messages.length,
            query: query,
            timestamp: new Date().toISOString()
        });

    } catch (error) {
        console.error('❌ Erro ao buscar mensagens:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// ========================================
// FUNCIONALIDADES AVANÇADAS PRO
// ========================================

// Reagir a mensagem
app.post('/react-message', async (req, res) => {
    try {
        const { messageId, reaction } = req.body;

        if (!messageId || !reaction) {
            return res.status(400).json({
                success: false,
                error: 'É necessário informar "messageId" e "reaction"'
            });
        }

        if (!isClientReady) {
            return res.status(503).json({
                success: false,
                error: 'WhatsApp não está conectado'
            });
        }

        // Buscar a mensagem pelo ID
        const chats = await client.getChats();
        let targetMessage = null;

        for (const chat of chats) {
            const messages = await chat.fetchMessages({ limit: 50 });
            targetMessage = messages.find(msg => msg.id._serialized === messageId);
            if (targetMessage) break;
        }

        if (!targetMessage) {
            return res.status(404).json({
                success: false,
                error: 'Mensagem não encontrada'
            });
        }

        await targetMessage.react(reaction);

        res.json({
            success: true,
            message: `Reação "${reaction}" adicionada à mensagem`,
            timestamp: new Date().toISOString()
        });

    } catch (error) {
        console.error('❌ Erro ao reagir à mensagem:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Editar mensagem
app.post('/edit-message', async (req, res) => {
    try {
        const { messageId, newContent } = req.body;

        if (!messageId || !newContent) {
            return res.status(400).json({
                success: false,
                error: 'É necessário informar "messageId" e "newContent"'
            });
        }

        if (!isClientReady) {
            return res.status(503).json({
                success: false,
                error: 'WhatsApp não está conectado'
            });
        }

        // Buscar a mensagem pelo ID
        const chats = await client.getChats();
        let targetMessage = null;

        for (const chat of chats) {
            const messages = await chat.fetchMessages({ limit: 50 });
            targetMessage = messages.find(msg => msg.id._serialized === messageId && msg.fromMe);
            if (targetMessage) break;
        }

        if (!targetMessage) {
            return res.status(404).json({
                success: false,
                error: 'Mensagem não encontrada ou não é sua'
            });
        }

        await targetMessage.edit(newContent);

        res.json({
            success: true,
            message: 'Mensagem editada com sucesso',
            timestamp: new Date().toISOString()
        });

    } catch (error) {
        console.error('❌ Erro ao editar mensagem:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Encaminhar mensagem
app.post('/forward-message', async (req, res) => {
    try {
        const { messageId, targetChatId } = req.body;

        if (!messageId || !targetChatId) {
            return res.status(400).json({
                success: false,
                error: 'É necessário informar "messageId" e "targetChatId"'
            });
        }

        if (!isClientReady) {
            return res.status(503).json({
                success: false,
                error: 'WhatsApp não está conectado'
            });
        }

        // Buscar a mensagem pelo ID
        const chats = await client.getChats();
        let targetMessage = null;

        for (const chat of chats) {
            const messages = await chat.fetchMessages({ limit: 50 });
            targetMessage = messages.find(msg => msg.id._serialized === messageId);
            if (targetMessage) break;
        }

        if (!targetMessage) {
            return res.status(404).json({
                success: false,
                error: 'Mensagem não encontrada'
            });
        }

        const targetChat = await client.getChatById(targetChatId);
        await targetMessage.forward(targetChat);

        res.json({
            success: true,
            message: 'Mensagem encaminhada com sucesso',
            timestamp: new Date().toISOString()
        });

    } catch (error) {
        console.error('❌ Erro ao encaminhar mensagem:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Pin mensagem
app.post('/pin-message', async (req, res) => {
    try {
        const { messageId, duration } = req.body;

        if (!messageId) {
            return res.status(400).json({
                success: false,
                error: 'É necessário informar "messageId"'
            });
        }

        if (!isClientReady) {
            return res.status(503).json({
                success: false,
                error: 'WhatsApp não está conectado'
            });
        }

        // Buscar a mensagem pelo ID
        const chats = await client.getChats();
        let targetMessage = null;

        for (const chat of chats) {
            const messages = await chat.fetchMessages({ limit: 50 });
            targetMessage = messages.find(msg => msg.id._serialized === messageId);
            if (targetMessage) break;
        }

        if (!targetMessage) {
            return res.status(404).json({
                success: false,
                error: 'Mensagem não encontrada'
            });
        }

        await targetMessage.pin(duration);

        res.json({
            success: true,
            message: 'Mensagem fixada com sucesso',
            timestamp: new Date().toISOString()
        });

    } catch (error) {
        console.error('❌ Erro ao fixar mensagem:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Unpin mensagem
app.post('/unpin-message', async (req, res) => {
    try {
        const { messageId } = req.body;

        if (!messageId) {
            return res.status(400).json({
                success: false,
                error: 'É necessário informar "messageId"'
            });
        }

        if (!isClientReady) {
            return res.status(503).json({
                success: false,
                error: 'WhatsApp não está conectado'
            });
        }

        // Buscar a mensagem pelo ID
        const chats = await client.getChats();
        let targetMessage = null;

        for (const chat of chats) {
            const messages = await chat.fetchMessages({ limit: 50 });
            targetMessage = messages.find(msg => msg.id._serialized === messageId);
            if (targetMessage) break;
        }

        if (!targetMessage) {
            return res.status(404).json({
                success: false,
                error: 'Mensagem não encontrada'
            });
        }

        await targetMessage.unpin();

        res.json({
            success: true,
            message: 'Mensagem desfixada com sucesso',
            timestamp: new Date().toISOString()
        });

    } catch (error) {
        console.error('❌ Erro ao desfixar mensagem:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Favoritar mensagem
app.post('/star-message', async (req, res) => {
    try {
        const { messageId } = req.body;

        if (!messageId) {
            return res.status(400).json({
                success: false,
                error: 'É necessário informar "messageId"'
            });
        }

        if (!isClientReady) {
            return res.status(503).json({
                success: false,
                error: 'WhatsApp não está conectado'
            });
        }

        // Buscar a mensagem pelo ID
        const chats = await client.getChats();
        let targetMessage = null;

        for (const chat of chats) {
            const messages = await chat.fetchMessages({ limit: 50 });
            targetMessage = messages.find(msg => msg.id._serialized === messageId);
            if (targetMessage) break;
        }

        if (!targetMessage) {
            return res.status(404).json({
                success: false,
                error: 'Mensagem não encontrada'
            });
        }

        await targetMessage.star();

        res.json({
            success: true,
            message: 'Mensagem favoritada com sucesso',
            timestamp: new Date().toISOString()
        });

    } catch (error) {
        console.error('❌ Erro ao favoritar mensagem:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Desfavoritar mensagem
app.post('/unstar-message', async (req, res) => {
    try {
        const { messageId } = req.body;

        if (!messageId) {
            return res.status(400).json({
                success: false,
                error: 'É necessário informar "messageId"'
            });
        }

        if (!isClientReady) {
            return res.status(503).json({
                success: false,
                error: 'WhatsApp não está conectado'
            });
        }

        // Buscar a mensagem pelo ID
        const chats = await client.getChats();
        let targetMessage = null;

        for (const chat of chats) {
            const messages = await chat.fetchMessages({ limit: 50 });
            targetMessage = messages.find(msg => msg.id._serialized === messageId);
            if (targetMessage) break;
        }

        if (!targetMessage) {
            return res.status(404).json({
                success: false,
                error: 'Mensagem não encontrada'
            });
        }

        await targetMessage.unstar();

        res.json({
            success: true,
            message: 'Mensagem desfavoritada com sucesso',
            timestamp: new Date().toISOString()
        });

    } catch (error) {
        console.error('❌ Erro ao desfavoritar mensagem:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Arquivar chat
app.post('/archive-chat', async (req, res) => {
    try {
        const { chatId } = req.body;

        if (!chatId) {
            return res.status(400).json({
                success: false,
                error: 'É necessário informar "chatId"'
            });
        }

        if (!isClientReady) {
            return res.status(503).json({
                success: false,
                error: 'WhatsApp não está conectado'
            });
        }

        const chat = await client.getChatById(chatId);
        await chat.archive();

        res.json({
            success: true,
            message: 'Chat arquivado com sucesso',
            timestamp: new Date().toISOString()
        });

    } catch (error) {
        console.error('❌ Erro ao arquivar chat:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Desarquivar chat
app.post('/unarchive-chat', async (req, res) => {
    try {
        const { chatId } = req.body;

        if (!chatId) {
            return res.status(400).json({
                success: false,
                error: 'É necessário informar "chatId"'
            });
        }

        if (!isClientReady) {
            return res.status(503).json({
                success: false,
                error: 'WhatsApp não está conectado'
            });
        }

        const chat = await client.getChatById(chatId);
        await chat.unarchive();

        res.json({
            success: true,
            message: 'Chat desarquivado com sucesso',
            timestamp: new Date().toISOString()
        });

    } catch (error) {
        console.error('❌ Erro ao desarquivar chat:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Pin chat
app.post('/pin-chat', async (req, res) => {
    try {
        const { chatId } = req.body;

        if (!chatId) {
            return res.status(400).json({
                success: false,
                error: 'É necessário informar "chatId"'
            });
        }

        if (!isClientReady) {
            return res.status(503).json({
                success: false,
                error: 'WhatsApp não está conectado'
            });
        }

        const chat = await client.getChatById(chatId);
        await chat.pin();

        res.json({
            success: true,
            message: 'Chat fixado com sucesso',
            timestamp: new Date().toISOString()
        });

    } catch (error) {
        console.error('❌ Erro ao fixar chat:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Unpin chat
app.post('/unpin-chat', async (req, res) => {
    try {
        const { chatId } = req.body;

        if (!chatId) {
            return res.status(400).json({
                success: false,
                error: 'É necessário informar "chatId"'
            });
        }

        if (!isClientReady) {
            return res.status(503).json({
                success: false,
                error: 'WhatsApp não está conectado'
            });
        }

        const chat = await client.getChatById(chatId);
        await chat.unpin();

        res.json({
            success: true,
            message: 'Chat desfixado com sucesso',
            timestamp: new Date().toISOString()
        });

    } catch (error) {
        console.error('❌ Erro ao desfixar chat:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Delete mensagem
app.post('/delete-message', async (req, res) => {
    try {
        const { messageId, everyone, clearMedia } = req.body;

        if (!messageId) {
            return res.status(400).json({
                success: false,
                error: 'É necessário informar "messageId"'
            });
        }

        if (!isClientReady) {
            return res.status(503).json({
                success: false,
                error: 'WhatsApp não está conectado'
            });
        }

        // Buscar a mensagem pelo ID
        const chats = await client.getChats();
        let targetMessage = null;

        for (const chat of chats) {
            const messages = await chat.fetchMessages({ limit: 50 });
            targetMessage = messages.find(msg => msg.id._serialized === messageId);
            if (targetMessage) break;
        }

        if (!targetMessage) {
            return res.status(404).json({
                success: false,
                error: 'Mensagem não encontrada'
            });
        }

        await targetMessage.delete(!!everyone, clearMedia !== false);

        res.json({
            success: true,
            message: 'Mensagem apagada com sucesso',
            timestamp: new Date().toISOString()
        });

    } catch (error) {
        console.error('❌ Erro ao apagar mensagem:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Bulk forward
app.post('/bulk-forward', async (req, res) => {
    try {
        const { messageIds, targetChatId } = req.body;
        if (!Array.isArray(messageIds) || !messageIds.length || !targetChatId) {
            return res.status(400).json({ success: false, error: 'Informe "messageIds" (array) e "targetChatId"' });
        }
        if (!isClientReady) {
            return res.status(503).json({ success: false, error: 'WhatsApp não está conectado' });
        }
        const targetChat = await client.getChatById(targetChatId);
        const chats = await client.getChats();
        const results = []
        for (const mid of messageIds) {
            let found = null
            for (const chat of chats) {
                const messages = await chat.fetchMessages({ limit: 50 });
                found = messages.find(msg => msg.id._serialized === mid);
                if (found) break;
            }
            if (!found) { results.push({ id: mid, success: false, error: 'Mensagem não encontrada' }); continue }
            try { await found.forward(targetChat); results.push({ id: mid, success: true }) } catch (e) { results.push({ id: mid, success: false, error: e.message }) }
        }
        res.json({ success: true, results, timestamp: new Date().toISOString() })
    } catch (error) {
        console.error('❌ Erro no bulk-forward:', error);
        res.status(500).json({ success: false, error: error.message })
    }
});

// Bulk delete
app.post('/bulk-delete', async (req, res) => {
    try {
        const { messageIds, everyone, clearMedia } = req.body;
        if (!Array.isArray(messageIds) || !messageIds.length) {
            return res.status(400).json({ success: false, error: 'Informe "messageIds" (array)' });
        }
        if (!isClientReady) {
            return res.status(503).json({ success: false, error: 'WhatsApp não está conectado' });
        }
        const chats = await client.getChats();
        const results = []
        for (const mid of messageIds) {
            let found = null
            for (const chat of chats) {
                const messages = await chat.fetchMessages({ limit: 50 });
                found = messages.find(msg => msg.id._serialized === mid);
                if (found) break;
            }
            if (!found) { results.push({ id: mid, success: false, error: 'Mensagem não encontrada' }); continue }
            try { await found.delete(!!everyone, clearMedia !== false); results.push({ id: mid, success: true }) } catch (e) { results.push({ id: mid, success: false, error: e.message }) }
        }
        res.json({ success: true, results, timestamp: new Date().toISOString() })
    } catch (error) {
        console.error('❌ Erro no bulk-delete:', error);
        res.status(500).json({ success: false, error: error.message })
    }
});

// Download de mídia
app.post('/download-media', async (req, res) => {
    try {
        const { messageId } = req.body;

        if (!messageId) {
            return res.status(400).json({
                success: false,
                error: 'É necessário informar "messageId"'
            });
        }

        if (!isClientReady) {
            return res.status(503).json({
                success: false,
                error: 'WhatsApp não está conectado'
            });
        }

        // Buscar a mensagem pelo ID
        const chats = await client.getChats();
        let targetMessage = null;

        for (const chat of chats) {
            const messages = await chat.fetchMessages({ limit: 50 });
            targetMessage = messages.find(msg => msg.id._serialized === messageId);
            if (targetMessage) break;
        }

        if (!targetMessage) {
            return res.status(404).json({
                success: false,
                error: 'Mensagem não encontrada'
            });
        }

        if (!targetMessage.hasMedia) {
            return res.status(400).json({
                success: false,
                error: 'Mensagem não contém mídia'
            });
        }

        const media = await targetMessage.downloadMedia();

        res.json({
            success: true,
            media: {
                mimetype: media.mimetype,
                filename: media.filename,
                data: media.data,
                size: media.filesize
            },
            timestamp: new Date().toISOString()
        });

    } catch (error) {
        console.error('❌ Erro ao baixar mídia:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Obter foto de perfil
app.get('/profile-picture/:contactId', async (req, res) => {
    try {
        const { contactId } = req.params;

        if (!isClientReady) {
            return res.status(503).json({
                success: false,
                error: 'WhatsApp não está conectado'
            });
        }

        const profilePicUrl = await client.getProfilePicUrl(contactId);

        res.json({
            success: true,
            profilePicUrl: profilePicUrl,
            contactId: contactId,
            timestamp: new Date().toISOString()
        });

    } catch (error) {
        console.error('❌ Erro ao obter foto de perfil:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Definir foto de perfil
app.post('/set-profile-picture', async (req, res) => {
    try {
        const { mediaPath, mediaUrl } = req.body;

        if (!mediaPath && !mediaUrl) {
            return res.status(400).json({
                success: false,
                error: 'É necessário informar "mediaPath" ou "mediaUrl"'
            });
        }

        if (!isClientReady) {
            return res.status(503).json({
                success: false,
                error: 'WhatsApp não está conectado'
            });
        }

        let media;

        if (mediaUrl) {
            media = await MessageMedia.fromUrl(mediaUrl);
        } else {
            media = MessageMedia.fromFilePath(mediaPath);
        }

        await client.setProfilePicture(media);

        res.json({
            success: true,
            message: 'Foto de perfil atualizada com sucesso',
            timestamp: new Date().toISOString()
        });

    } catch (error) {
        console.error('❌ Erro ao definir foto de perfil:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Definir nome de exibição
app.post('/set-display-name', async (req, res) => {
    try {
        const { displayName } = req.body;

        if (!displayName) {
            return res.status(400).json({
                success: false,
                error: 'É necessário informar "displayName"'
            });
        }

        if (!isClientReady) {
            return res.status(503).json({
                success: false,
                error: 'WhatsApp não está conectado'
            });
        }

        await client.setDisplayName(displayName);

        res.json({
            success: true,
            message: 'Nome de exibição atualizado com sucesso',
            timestamp: new Date().toISOString()
        });

    } catch (error) {
        console.error('❌ Erro ao definir nome de exibição:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Estados de presença
app.post('/set-presence', async (req, res) => {
    try {
        const { status } = req.body; // 'available' ou 'unavailable'

        if (!status || !['available', 'unavailable'].includes(status)) {
            return res.status(400).json({
                success: false,
                error: 'É necessário informar "status" como "available" ou "unavailable"'
            });
        }

        if (!isClientReady) {
            return res.status(503).json({
                success: false,
                error: 'WhatsApp não está conectado'
            });
        }

        if (status === 'available') {
            await client.sendPresenceAvailable();
        } else {
            await client.sendPresenceUnavailable();
        }

        res.json({
            success: true,
            message: `Presença definida como ${status}`,
            timestamp: new Date().toISOString()
        });

    } catch (error) {
        console.error('❌ Erro ao definir presença:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Estado de digitando
app.post('/send-typing', async (req, res) => {
    try {
        const { chatId } = req.body;

        if (!chatId) {
            return res.status(400).json({
                success: false,
                error: 'É necessário informar "chatId"'
            });
        }

        if (!isClientReady) {
            return res.status(503).json({
                success: false,
                error: 'WhatsApp não está conectado'
            });
        }

        const chat = await client.getChatById(chatId);
        await chat.sendStateTyping();

        res.json({
            success: true,
            message: 'Estado "digitando" enviado',
            timestamp: new Date().toISOString()
        });

    } catch (error) {
        console.error('❌ Erro ao enviar estado digitando:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Estado de gravando
app.post('/send-recording', async (req, res) => {
    try {
        const { chatId } = req.body;

        if (!chatId) {
            return res.status(400).json({
                success: false,
                error: 'É necessário informar "chatId"'
            });
        }

        if (!isClientReady) {
            return res.status(503).json({
                success: false,
                error: 'WhatsApp não está conectado'
            });
        }

        const chat = await client.getChatById(chatId);
        await chat.sendStateRecording();

        res.json({
            success: true,
            message: 'Estado "gravando" enviado',
            timestamp: new Date().toISOString()
        });

    } catch (error) {
        console.error('❌ Erro ao enviar estado gravando:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Listar contatos bloqueados
app.get('/blocked-contacts', async (req, res) => {
    try {
        if (!isClientReady) {
            return res.status(503).json({
                success: false,
                error: 'WhatsApp não está conectado'
            });
        }

        const blockedContacts = await client.getBlockedContacts();
        const contactList = blockedContacts.map(contact => ({
            id: contact.id._serialized,
            name: contact.name || contact.pushname || 'Sem nome',
            number: contact.number,
            isBlocked: contact.isBlocked
        }));

        res.json({
            success: true,
            blockedContacts: contactList,
            total: blockedContacts.length,
            timestamp: new Date().toISOString()
        });

    } catch (error) {
        console.error('❌ Erro ao listar contatos bloqueados:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Obter informações da mensagem (status de entrega)
app.get('/message-info/:messageId', async (req, res) => {
    try {
        const { messageId } = req.params;

        if (!isClientReady) {
            return res.status(503).json({
                success: false,
                error: 'WhatsApp não está conectado'
            });
        }

        // Buscar a mensagem pelo ID
        const chats = await client.getChats();
        let targetMessage = null;

        for (const chat of chats) {
            const messages = await chat.fetchMessages({ limit: 50 });
            targetMessage = messages.find(msg => msg.id._serialized === messageId);
            if (targetMessage) break;
        }

        if (!targetMessage) {
            return res.status(404).json({
                success: false,
                error: 'Mensagem não encontrada'
            });
        }

        const messageInfo = await targetMessage.getInfo();

        res.json({
            success: true,
            messageInfo: {
                delivery: messageInfo.delivery,
                played: messageInfo.played,
                read: messageInfo.read
            },
            timestamp: new Date().toISOString()
        });

    } catch (error) {
        console.error('❌ Erro ao obter informações da mensagem:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Listar broadcasts
app.get('/broadcasts', async (req, res) => {
    try {
        if (!isClientReady) {
            return res.status(503).json({
                success: false,
                error: 'WhatsApp não está conectado'
            });
        }

        const broadcasts = await client.getBroadcasts();
        const broadcastList = broadcasts.map(broadcast => ({
            id: broadcast.id._serialized,
            timestamp: broadcast.timestamp,
            totalCount: broadcast.totalCount,
            unreadCount: broadcast.unreadCount
        }));

        res.json({
            success: true,
            broadcasts: broadcastList,
            total: broadcasts.length,
            timestamp: new Date().toISOString()
        });

    } catch (error) {
        console.error('❌ Erro ao listar broadcasts:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Obter versão do WhatsApp Web
app.get('/whatsapp-version', async (req, res) => {
    try {
        if (!isClientReady) {
            return res.status(503).json({
                success: false,
                error: 'WhatsApp não está conectado'
            });
        }

        const version = await client.getWWebVersion();

        res.json({
            success: true,
            version: version,
            timestamp: new Date().toISOString()
        });

    } catch (error) {
        console.error('❌ Erro ao obter versão do WhatsApp:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Obter status da bateria
app.get('/battery-status', async (req, res) => {
    try {
        if (!isClientReady) {
            return res.status(503).json({
                success: false,
                error: 'WhatsApp não está conectado'
            });
        }

        const batteryInfo = await client.info.getBatteryStatus();

        res.json({
            success: true,
            battery: batteryInfo,
            timestamp: new Date().toISOString()
        });

    } catch (error) {
        console.error('❌ Erro ao obter status da bateria:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// ========================================
// TRATAMENTO DE ERROS E INICIALIZAÇÃO
// ========================================

// Tratamento de erros globais
process.on('uncaughtException', (error) => {
    console.error('❌ Erro não capturado:', error);
    lastError = `Erro crítico: ${error.message}`;
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('❌ Promise rejeitada:', reason);
    lastError = `Promise rejeitada: ${reason}`;
});

// Graceful shutdown
process.on('SIGINT', async () => {
    console.log('🛑 Encerrando bot...');
    if (client) {
        await client.destroy().catch(() => { });
    }
    process.exit(0);
});

// Iniciar servidor
app.listen(PORT, '0.0.0.0', () => {
    console.log(`🌐 Servidor HTTP iniciado na porta ${PORT}`);
    console.log(`📋 Interface Local: http://localhost:${PORT}`);
    console.log(`🤖 Interface Agent-Zero: http://192.168.15.14:${PORT}`);
    console.log(`🔧 Otimizado para macOS`);
});

// Inicializar cliente WhatsApp
console.log('🔄 Inicializando cliente WhatsApp...');
initializeClient();
