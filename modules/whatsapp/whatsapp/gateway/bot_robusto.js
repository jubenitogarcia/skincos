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

// Cliente WhatsApp com configuração mais robusta
const client = new Client({
    authStrategy: new LocalAuth({
        dataPath: './.wwebjs_auth'
    }),
    puppeteer: {
        headless: false,
        executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-accelerated-2d-canvas',
            '--no-first-run',
            '--no-zygote',
            '--disable-gpu',
            '--disable-extensions'
        ],
        timeout: 60000
    }
});

// Variáveis de controle
let isClientReady = false;
let qrCodeData = null;
let lastError = null;

console.log('🚀 Iniciando Bot WhatsApp Robusto com API...');
console.log('🔧 Configuração melhorada para macOS');

// ========================================
// EVENTOS DO WHATSAPP
// ========================================

client.on('qr', (qr) => {
    console.log('📱 QR Code recebido! Escaneie com seu WhatsApp:');
    qrcode.generate(qr, { small: true });
    qrCodeData = qr;
    isClientReady = false;
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

client.on('ready', () => {
    console.log('🎉 Cliente WhatsApp está pronto!');
    console.log('💡 Envie "!ping" para qualquer chat para testar');
    isClientReady = true;
    lastError = null;

    // Obter informações do usuário
    client.info.then(info => {
        console.log(`📱 Conectado como: ${info.pushname} (${info.wid.user})`);
        console.log(`🌐 Versão WhatsApp Web: ${info.version}`);
    }).catch(err => {
        console.log('⚠️ Não foi possível obter informações do usuário');
    });
});

client.on('disconnected', (reason) => {
    console.log('❌ Cliente desconectado:', reason);
    isClientReady = false;
    lastError = `Desconectado: ${reason}`;
});

// Handler de mensagens
client.on('message', async msg => {
    try {
        console.log(`📨 Mensagem recebida de ${msg.from}: ${msg.body}`);

        if (msg.body === '!ping') {
            await msg.reply('🏓 Pong! Bot está funcionando!');
        } else if (msg.body === '!info') {
            const info = await client.info;
            await msg.reply(`ℹ️ Bot Info:\n📱 ${info.pushname}\n🌐 ${info.version}`);
        } else if (msg.body === '!help') {
            await msg.reply(`🤖 Comandos disponíveis:
!ping - Teste de conectividade
!info - Informações do bot
!help - Lista de comandos`);
        }
    } catch (error) {
        console.error('❌ Erro ao processar mensagem:', error);
    }
});

// ========================================
// ROTAS DA API
// ========================================

// Servir arquivos estáticos
app.use(express.static('public'));

// Página inicial com interface web
app.get('/', (req, res) => {
    res.send(`
    <!DOCTYPE html>
    <html lang="pt-BR">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>WhatsApp Bot API - Versão Robusta</title>
        <style>
            body { font-family: Arial, sans-serif; margin: 20px; background: #f5f5f5; }
            .container { max-width: 1200px; margin: 0 auto; background: white; padding: 20px; border-radius: 10px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); }
            .header { text-align: center; color: #25D366; margin-bottom: 30px; }
            .section { margin: 20px 0; padding: 15px; border: 1px solid #ddd; border-radius: 5px; }
            .endpoint { background: #f9f9f9; padding: 10px; margin: 10px 0; border-left: 4px solid #25D366; }
            .status { padding: 10px; border-radius: 5px; margin: 10px 0; }
            .ready { background: #d4edda; color: #155724; border: 1px solid #c3e6cb; }
            .waiting { background: #fff3cd; color: #856404; border: 1px solid #ffeaa7; }
            .error { background: #f8d7da; color: #721c24; border: 1px solid #f5c6cb; }
            code { background: #f4f4f4; padding: 2px 4px; border-radius: 3px; }
            .form-group { margin: 15px 0; }
            label { display: block; margin-bottom: 5px; font-weight: bold; }
            input, textarea { width: 100%; padding: 8px; border: 1px solid #ddd; border-radius: 4px; }
            button { background: #25D366; color: white; padding: 10px 20px; border: none; border-radius: 4px; cursor: pointer; }
            button:hover { background: #1ea952; }
            .refresh { float: right; }
        </style>
    </head>
    <body>
        <div class="container">
            <div class="header">
                <h1>🚀 WhatsApp Bot API - Versão Robusta</h1>
                <p>Sistema de automação WhatsApp com configuração melhorada para macOS</p>
                <button class="refresh" onclick="location.reload()">🔄 Atualizar</button>
            </div>

            <div class="section">
                <h2>📊 Status do Sistema</h2>
                <div class="status ready" id="status">
                    ✅ Servidor API ativo - Verificando conexão WhatsApp...
                </div>
            </div>

            <div class="section">
                <h2>🚀 Acesso Rápido ao CRM</h2>
                <div style="text-align: center; padding: 20px; background: linear-gradient(135deg, #25D366, #128C7E); border-radius: 10px; margin: 20px 0;">
                    <h3 style="color: white; margin: 0 0 10px 0;">📱 WhatsApp CRM Dashboard</h3>
                    <p style="color: rgba(255,255,255,0.9); margin: 0 0 20px 0;">Gerencie contatos, campanhas, mensagens e analytics</p>
                    <a href="/crm-dashboard.html" target="_blank" style="background: white; color: #25D366; padding: 15px 30px; text-decoration: none; border-radius: 25px; font-weight: bold; display: inline-block; transition: transform 0.2s;">
                        🎛️ Abrir CRM Dashboard
                    </a>
                </div>
            </div>

            <div class="section">
                <h2>🌐 URLs e Endpoints</h2>
                <div class="endpoint">
                    <strong>CRM Dashboard:</strong> <code><a href="/crm-dashboard.html" target="_blank">/crm-dashboard.html</a></code><br>
                    🎛️ Interface completa de CRM para WhatsApp
                </div>
                <div class="endpoint">
                    <strong>QR Code:</strong> <code><a href="/qr.html" target="_blank">/qr.html</a></code><br>
                    📱 Interface para conectar WhatsApp via QR Code
                </div>
                <div class="endpoint">
                    <strong>Status API:</strong> <code>GET /status</code><br>
                    📊 Verificar status detalhado do bot
                </div>
                <div class="endpoint">
                    <strong>Enviar Mensagem:</strong> <code>POST /send</code><br>
                    📱 Enviar mensagens programaticamente
                </div>
                <div class="endpoint">
                    <strong>Listar Chats:</strong> <code>GET /chats</code><br>
                    💬 Obter lista de conversas ativas
                </div>
                <div class="endpoint">
                    <strong>API CRM:</strong> <code>GET /v1/contacts, /v1/conversations, /v1/analytics/overview</code><br>
                    🔧 Endpoints avançados para integração CRM
                </div>
            </div>

            <div class="section">
                <h2>🧪 Teste Rápido de Envio</h2>
                <div class="form-group">
                    <label for="phone">Número (com código do país):</label>
                    <input type="text" id="phone" placeholder="+5551995103563" value="+5551995103563">
                </div>
                <div class="form-group">
                    <label for="message">Mensagem:</label>
                    <textarea id="message" rows="3" placeholder="Digite sua mensagem...">🤖 Teste via interface web - Bot robusto funcionando!</textarea>
                </div>
                <button onclick="sendMessage()">📱 Enviar Mensagem</button>
                <div id="result" style="margin-top: 15px;"></div>
            </div>

            <div class="section">
                <h2>📖 Exemplos de cURL</h2>
                <div class="endpoint">
                    <strong>Status:</strong><br>
                    <code>curl http://localhost:3001/status | jq</code>
                </div>
                <div class="endpoint">
                    <strong>Enviar:</strong><br>
                    <code>curl -X POST http://localhost:3001/send \\<br>
                    &nbsp;&nbsp;-H "Content-Type: application/json" \\<br>
                    &nbsp;&nbsp;-d '{"phone": "+5551995103563", "message": "Teste!"}'</code>
                </div>
            </div>
        </div>

        <script>
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
                    result.innerHTML = '<div class="status error">❌ Erro de conexão: ' + error.message + '</div>';
                }
            }

            // Atualizar status a cada 3 segundos
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
                        statusDiv.innerHTML = '📱 QR Code gerado - Escaneie com WhatsApp';
                    } else if (data.error) {
                        statusDiv.className = 'status error';
                        statusDiv.innerHTML = '❌ Erro: ' + data.error;
                    } else {
                        statusDiv.className = 'status waiting';
                        statusDiv.innerHTML = '⏳ Inicializando WhatsApp...';
                    }
                } catch (error) {
                    console.log('Status check failed:', error);
                }
            }, 3000);
        </script>
    </body>
    </html>
    `);
});

// Status da API
app.get('/status', async (req, res) => {
    try {
        let userInfo = null;
        if (isClientReady) {
            try {
                const info = await client.info;
                userInfo = `${info.pushname} (${info.wid.user})`;
            } catch (err) {
                userInfo = 'Conectado';
            }
        }

        res.json({
            ready: isClientReady,
            qr: qrCodeData !== null,
            user: userInfo,
            error: lastError,
            timestamp: new Date().toISOString(),
            version: '1.0-robust'
        });
    } catch (error) {
        res.status(500).json({
            ready: false,
            error: error.message,
            timestamp: new Date().toISOString()
        });
    }
});

// Enviar mensagem
app.post('/send', async (req, res) => {
    try {
        const { phone, message } = req.body;

        if (!phone || !message) {
            return res.status(400).json({
                success: false,
                error: 'Parâmetros "phone" e "message" são obrigatórios'
            });
        }

        if (!isClientReady) {
            return res.status(503).json({
                success: false,
                error: 'WhatsApp não está conectado'
            });
        }

        // Formatar número
        const formattedPhone = phone.replace(/[^\d]/g, '') + '@c.us';

        // Enviar mensagem
        await client.sendMessage(formattedPhone, message);

        res.json({
            success: true,
            message: `Mensagem enviada para ${phone}`,
            timestamp: new Date().toISOString()
        });

    } catch (error) {
        console.error('❌ Erro ao enviar mensagem:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Listar chats
app.get('/chats', async (req, res) => {
    try {
        if (!isClientReady) {
            return res.status(503).json({
                success: false,
                error: 'WhatsApp não está conectado'
            });
        }

        const chats = await client.getChats();
        const chatList = chats.slice(0, 10).map(chat => ({
            id: chat.id._serialized,
            name: chat.name || 'Chat sem nome',
            isGroup: chat.isGroup,
            unreadCount: chat.unreadCount
        }));

        res.json({
            success: true,
            chats: chatList,
            total: chats.length
        });

    } catch (error) {
        console.error('❌ Erro ao listar chats:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// ========================================
// CRM ENDPOINTS v1
// ========================================

// Get contact info
app.get('/v1/contacts/:phone', async (req, res) => {
    try {
        if (!isClientReady) {
            return res.status(503).json({
                success: false,
                error: 'WhatsApp não está conectado'
            });
        }

        const phone = req.params.phone.replace(/[^\d]/g, '') + '@c.us';
        const contact = await client.getContactById(phone);
        
        if (contact) {
            res.json({
                success: true,
                contact: {
                    id: contact.id._serialized,
                    name: contact.name || contact.pushname || 'Sem nome',
                    phone: phone.replace('@c.us', ''),
                    profilePicUrl: await contact.getProfilePicUrl() || null,
                    isBlocked: contact.isBlocked,
                    isWAContact: contact.isWAContact
                }
            });
        } else {
            res.status(404).json({
                success: false,
                error: 'Contato não encontrado'
            });
        }

    } catch (error) {
        console.error('❌ Erro ao buscar contato:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Get messages from a chat
app.get('/v1/messages/:chatId', async (req, res) => {
    try {
        if (!isClientReady) {
            return res.status(503).json({
                success: false,
                error: 'WhatsApp não está conectado'
            });
        }

        const chatId = req.params.chatId;
        const limit = parseInt(req.query.limit) || 50;
        
        const chat = await client.getChatById(chatId);
        const messages = await chat.fetchMessages({ limit });

        const messageList = messages.map(msg => ({
            id: msg.id.id,
            from: msg.from,
            to: msg.to,
            body: msg.body,
            type: msg.type,
            timestamp: msg.timestamp,
            fromMe: msg.fromMe,
            hasMedia: msg.hasMedia
        }));

        res.json({
            success: true,
            messages: messageList,
            chat: {
                id: chat.id._serialized,
                name: chat.name || 'Chat sem nome',
                isGroup: chat.isGroup
            }
        });

    } catch (error) {
        console.error('❌ Erro ao buscar mensagens:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Get all contacts
app.get('/v1/contacts', async (req, res) => {
    try {
        if (!isClientReady) {
            return res.status(503).json({
                success: false,
                error: 'WhatsApp não está conectado'
            });
        }

        const contacts = await client.getContacts();
        const contactList = await Promise.all(
            contacts.slice(0, 100).map(async (contact) => {
                try {
                    return {
                        id: contact.id._serialized,
                        name: contact.name || contact.pushname || 'Sem nome',
                        phone: contact.number,
                        isBlocked: contact.isBlocked,
                        isWAContact: contact.isWAContact
                    };
                } catch (err) {
                    return {
                        id: contact.id._serialized,
                        name: contact.name || contact.pushname || 'Sem nome',
                        phone: contact.number,
                        isBlocked: false,
                        isWAContact: true
                    };
                }
            })
        );

        res.json({
            success: true,
            contacts: contactList.filter(c => c.isWAContact),
            total: contactList.length
        });

    } catch (error) {
        console.error('❌ Erro ao listar contatos:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Get conversation list with last message
app.get('/v1/conversations', async (req, res) => {
    try {
        if (!isClientReady) {
            return res.status(503).json({
                success: false,
                error: 'WhatsApp não está conectado'
            });
        }

        const chats = await client.getChats();
        const conversations = await Promise.all(
            chats.slice(0, 20).map(async (chat) => {
                try {
                    const lastMessage = chat.lastMessage;
                    return {
                        id: chat.id._serialized,
                        name: chat.name || 'Chat sem nome',
                        isGroup: chat.isGroup,
                        unreadCount: chat.unreadCount,
                        lastMessage: lastMessage ? {
                            body: lastMessage.body,
                            timestamp: lastMessage.timestamp,
                            fromMe: lastMessage.fromMe
                        } : null,
                        timestamp: chat.timestamp
                    };
                } catch (err) {
                    return {
                        id: chat.id._serialized,
                        name: chat.name || 'Chat sem nome',
                        isGroup: chat.isGroup,
                        unreadCount: chat.unreadCount,
                        lastMessage: null,
                        timestamp: chat.timestamp
                    };
                }
            })
        );

        res.json({
            success: true,
            conversations: conversations.sort((a, b) => b.timestamp - a.timestamp)
        });

    } catch (error) {
        console.error('❌ Erro ao listar conversas:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Analytics endpoint
app.get('/v1/analytics/overview', async (req, res) => {
    try {
        if (!isClientReady) {
            return res.status(503).json({
                success: false,
                error: 'WhatsApp não está conectado'
            });
        }

        const chats = await client.getChats();
        const contacts = await client.getContacts();
        
        // Calculate basic analytics
        const totalChats = chats.length;
        const totalContacts = contacts.filter(c => c.isWAContact).length;
        const unreadMessages = chats.reduce((sum, chat) => sum + chat.unreadCount, 0);
        const groupChats = chats.filter(chat => chat.isGroup).length;

        res.json({
            success: true,
            analytics: {
                totalChats,
                totalContacts,
                unreadMessages,
                groupChats,
                privateChats: totalChats - groupChats,
                timestamp: new Date().toISOString()
            }
        });

    } catch (error) {
        console.error('❌ Erro ao gerar analytics:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Webhook for message events (for integration)
app.post('/v1/webhook', (req, res) => {
    try {
        const { event, data } = req.body;
        
        console.log('📥 Webhook recebido:', { event, data });
        
        // Here you can add logic to handle different webhook events
        // For example: new message, message status update, etc.
        
        res.json({
            success: true,
            message: 'Webhook processado com sucesso',
            timestamp: new Date().toISOString()
        });

    } catch (error) {
        console.error('❌ Erro ao processar webhook:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// ========================================
// INICIALIZAÇÃO
// ========================================

// Iniciar servidor
app.listen(PORT, () => {
    console.log(`🌐 Servidor HTTP iniciado na porta ${PORT}`);
    console.log(`📋 Acesse http://localhost:${PORT} para ver a documentação`);
});

// Inicializar cliente com tratamento de erro
process.on('uncaughtException', (error) => {
    console.error('❌ Erro não capturado:', error);
    lastError = error.message;
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('❌ Promise rejeitada:', reason);
    lastError = reason;
});

// Iniciar cliente WhatsApp
console.log('🔄 Inicializando cliente WhatsApp...');
client.initialize().catch(error => {
    console.error('❌ Erro ao inicializar:', error);
    lastError = error.message;
});
