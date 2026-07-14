const { Client, LocalAuth } = require('./index');
const qrcode = require('qrcode-terminal');
const express = require('express');
const cors = require('cors');
const fs = require('fs');

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
let isHeadless = true; // Modo headless por padrão

console.log('🤖 Iniciando Bot WhatsApp - MODO HEADLESS');
console.log('');
console.log('📋 MODO OPERAÇÃO:');
console.log('   🔇 Chrome: HEADLESS (sem interface visual)');
console.log('   🤖 Interação: APENAS via Agent-Zero/API');
console.log('   📱 QR Code: Apenas no primeiro uso');
console.log('');

// Função para criar cliente headless
function createClient() {
    try {
        const puppeteerConfig = {
            headless: isHeadless ? 'new' : false, // Usar 'new' para headless moderno
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
                '--disable-ipc-flooding-protection',
                '--disable-web-security',
                '--disable-features=VizDisplayCompositor'
            ],
            timeout: 120000,
            ignoreDefaultArgs: ['--disable-extensions']
        };

        // Adicionar argumentos específicos para headless
        if (isHeadless) {
            puppeteerConfig.args.push(
                '--disable-background-networking',
                '--disable-background-timer-throttling',
                '--disable-client-side-phishing-detection',
                '--disable-default-apps',
                '--disable-hang-monitor',
                '--disable-popup-blocking',
                '--disable-prompt-on-repost',
                '--disable-sync',
                '--metrics-recording-only',
                '--no-first-run',
                '--safebrowsing-disable-auto-update',
                '--enable-automation',
                '--password-store=basic',
                '--use-mock-keychain'
            );
        }

        client = new Client({
            authStrategy: new LocalAuth({
                dataPath: './.wwebjs_auth',
                clientId: 'headless-client'
            }),
            puppeteer: puppeteerConfig
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
        console.log('📱 QR Code recebido! (Primeira autenticação)');
        console.log('⚠️ IMPORTANTE: Este QR só aparece na primeira vez');
        console.log('💡 Após escanear, nunca mais precisará ver o Chrome!');
        console.log('');
        qrcode.generate(qr, { small: true });
        qrCodeData = qr;
        isClientReady = false;
        lastError = null;

        // Salvar QR Code em arquivo para facilitar acesso
        fs.writeFileSync('./qr_code.txt', qr);
        console.log('💾 QR Code salvo em: ./qr_code.txt');
    });

    client.on('authenticated', () => {
        console.log('✅ Autenticado com sucesso!');
        qrCodeData = null;
        lastError = null;

        // Remover arquivo de QR Code
        if (fs.existsSync('./qr_code.txt')) {
            fs.unlinkSync('./qr_code.txt');
        }
    });

    client.on('auth_failure', msg => {
        console.error('❌ Falha na autenticação:', msg);
        lastError = `Falha na autenticação: ${msg}`;
        isClientReady = false;
    });

    client.on('ready', async () => {
        console.log('🎉 Cliente WhatsApp está pronto - MODO HEADLESS!');
        console.log('');
        console.log('✅ SISTEMA OPERACIONAL:');
        console.log('   🤖 Modo: HEADLESS (sem interface Chrome)');
        console.log('   🔌 API: http://localhost:3001');
        console.log('   🤖 Agent-Zero: Pronto para uso');
        console.log('   📱 Chrome: Invisível em background');
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
                await msg.reply('🏓 Pong! Bot HEADLESS funcionando perfeitamente!');
            } else if (msg.body === '!info') {
                const info = clientInfo || await client.info;
                await msg.reply(`ℹ️ Bot Info:
📱 ${info.pushname}
🌐 ${info.version}
🤖 Modo: HEADLESS
🖥️ Servidor: macOS optimized
⏰ ${new Date().toLocaleString('pt-BR')}`);
            } else if (msg.body === '!help') {
                await msg.reply(`🤖 Comandos disponíveis:
!ping - Teste de conectividade
!info - Informações do bot
!help - Lista de comandos
!status - Status detalhado
!headless - Info sobre modo headless`);
            } else if (msg.body === '!status') {
                await msg.reply(`📊 Status do Sistema:
✅ Bot: Conectado
🤖 Modo: HEADLESS
🌐 API: http://localhost:3001
📱 WhatsApp: Ativo
🖥️ Sistema: macOS`);
            } else if (msg.body === '!headless') {
                await msg.reply(`🤖 Modo HEADLESS ativo:
✅ Chrome: Invisível
🔌 Interação: Apenas via API
🤖 Agent-Zero: Operacional
📊 Performance: Otimizada`);
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

// Função para alternar modo headless (para debug)
function toggleHeadless() {
    isHeadless = !isHeadless;
    console.log(`🔄 Alternando para modo: ${isHeadless ? 'HEADLESS' : 'VISUAL'}`);
    return isHeadless;
}

// ========================================
// ROTAS DA API
// ========================================

// Página inicial com interface web para modo headless
app.get('/', (req, res) => {
    res.send(`
    <!DOCTYPE html>
    <html lang="pt-BR">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>WhatsApp Bot - MODO HEADLESS</title>
        <style>
            body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Arial, sans-serif; margin: 20px; background: linear-gradient(135deg, #000000 0%, #434343 100%); min-height: 100vh; color: white; }
            .container { max-width: 1200px; margin: 0 auto; background: rgba(255,255,255,0.1); padding: 30px; border-radius: 15px; box-shadow: 0 10px 30px rgba(0,0,0,0.3); backdrop-filter: blur(10px); }
            .header { text-align: center; margin-bottom: 30px; }
            .header h1 { color: #00ff00; margin: 0; font-size: 2.5em; text-shadow: 0 0 10px #00ff00; }
            .header p { color: #ccc; margin: 10px 0; }
            .badge { display: inline-block; background: #00ff00; color: black; padding: 5px 15px; border-radius: 20px; font-size: 0.9em; margin: 5px; font-weight: bold; }
            .section { margin: 25px 0; padding: 20px; border: 1px solid rgba(255,255,255,0.2); border-radius: 10px; background: rgba(0,0,0,0.3); }
            .section h2 { color: #00ff00; margin-top: 0; }
            .endpoint { background: rgba(255,255,255,0.1); padding: 15px; margin: 15px 0; border-left: 4px solid #00ff00; border-radius: 5px; }
            .status { padding: 15px; border-radius: 10px; margin: 15px 0; font-weight: bold; }
            .ready { background: rgba(0,255,0,0.2); color: #00ff00; border: 2px solid #00ff00; }
            .waiting { background: rgba(255,255,0,0.2); color: #ffff00; border: 2px solid #ffff00; }
            .error { background: rgba(255,0,0,0.2); color: #ff6666; border: 2px solid #ff0000; }
            code { background: rgba(0,0,0,0.5); padding: 5px 8px; border-radius: 5px; font-family: 'Monaco', 'Courier New', monospace; color: #00ff00; }
            .form-group { margin: 20px 0; }
            label { display: block; margin-bottom: 8px; font-weight: bold; color: #ccc; }
            input, textarea { width: 100%; padding: 12px; border: 2px solid #333; border-radius: 8px; font-size: 16px; background: rgba(0,0,0,0.5); color: white; }
            input:focus, textarea:focus { outline: none; border-color: #00ff00; }
            button { background: linear-gradient(135deg, #00ff00 0%, #00cc00 100%); color: black; padding: 12px 25px; border: none; border-radius: 8px; cursor: pointer; font-size: 16px; font-weight: bold; transition: all 0.3s; }
            button:hover { transform: translateY(-2px); box-shadow: 0 5px 15px rgba(0, 255, 0, 0.4); }
            .stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 15px; margin: 20px 0; }
            .stat-card { background: rgba(0,0,0,0.5); padding: 20px; border-radius: 10px; text-align: center; border: 1px solid rgba(255,255,255,0.1); }
            .stat-number { font-size: 2em; font-weight: bold; color: #00ff00; }
            .stat-label { color: #ccc; margin-top: 5px; }
            .headless-badge { background: #000; color: #00ff00; border: 2px solid #00ff00; padding: 10px; border-radius: 10px; text-align: center; margin: 20px 0; }
        </style>
    </head>
    <body>
        <div class="container">
            <div class="header">
                <h1>🤖 WhatsApp Bot - HEADLESS MODE</h1>
                <p>Sistema Invisível - Operação Totalmente em Background</p>
                <div>
                    <span class="badge">🤖 HEADLESS</span>
                    <span class="badge">🔇 SEM INTERFACE</span>
                    <span class="badge">⚡ ALTA PERFORMANCE</span>
                </div>
            </div>

            <div class="headless-badge">
                <h3>🤖 MODO HEADLESS ATIVO</h3>
                <p>✅ Chrome rodando invisível em background<br>
                🤖 Interação apenas via Agent-Zero/API<br>
                ⚡ Performance otimizada para automação</p>
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
                <h2>🌐 API Endpoints</h2>
                <div class="endpoint">
                    <strong>📊 Status:</strong> <code>GET /status</code><br>
                    Verificar status do bot headless
                </div>
                <div class="endpoint">
                    <strong>📱 Enviar:</strong> <code>POST /send</code><br>
                    Enviar mensagens via Agent-Zero
                </div>
                <div class="endpoint">
                    <strong>💬 Chats:</strong> <code>GET /chats</code><br>
                    Listar conversas ativas
                </div>
                <div class="endpoint">
                    <strong>🔄 Toggle Mode:</strong> <code>POST /toggle-headless</code><br>
                    Alternar modo headless (debug)
                </div>
            </div>

            <div class="section">
                <h2>🧪 Teste Agent-Zero</h2>
                <div class="form-group">
                    <label for="phone">📞 Número (Agent-Zero):</label>
                    <input type="text" id="phone" placeholder="+5551995103563" value="+5551995103563">
                </div>
                <div class="form-group">
                    <label for="message">🤖 Mensagem:</label>
                    <textarea id="message" rows="4" placeholder="Mensagem do Agent-Zero...">🤖 Teste modo HEADLESS - Agent-Zero operacional! 🚀</textarea>
                </div>
                <button onclick="sendMessage()">🤖 Simular Agent-Zero</button>
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
                    result.innerHTML = '<div class="status waiting">⏳ Agent-Zero enviando...</div>';

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

            // Atualizar status
            setInterval(async () => {
                try {
                    const response = await fetch('/status');
                    const data = await response.json();
                    const statusDiv = document.getElementById('status');

                    if (data.ready) {
                        statusDiv.className = 'status ready';
                        statusDiv.innerHTML = '✅ WhatsApp HEADLESS conectado: ' + (data.user || 'Usuário ativo');
                    } else if (data.qr) {
                        statusDiv.className = 'status waiting';
                        statusDiv.innerHTML = '📱 QR Code disponível - Primeira autenticação';
                    } else if (data.error) {
                        statusDiv.className = 'status error';
                        statusDiv.innerHTML = '❌ ' + data.error;
                    } else {
                        statusDiv.className = 'status waiting';
                        statusDiv.innerHTML = '⏳ Inicializando modo HEADLESS...';
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

// Status da API (incluindo modo headless)
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
            headless: isHeadless,
            mode: isHeadless ? 'HEADLESS' : 'VISUAL',
            timestamp: new Date().toISOString(),
            version: '3.0-headless'
        });
    } catch (error) {
        res.status(500).json({
            ready: false,
            error: error.message,
            timestamp: new Date().toISOString()
        });
    }
});

// Rota para alternar modo headless
app.post('/toggle-headless', (req, res) => {
    const newMode = toggleHeadless();
    res.json({
        success: true,
        headless: newMode,
        mode: newMode ? 'HEADLESS' : 'VISUAL',
        message: `Modo alterado para: ${newMode ? 'HEADLESS' : 'VISUAL'}. Reinicie o bot para aplicar.`
    });
});

// Enviar mensagem (mesma funcionalidade)
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
                error: 'WhatsApp HEADLESS não está conectado. Verifique o status.'
            });
        }

        const cleanPhone = phone.replace(/[^\d]/g, '');
        const formattedPhone = cleanPhone + '@c.us';

        await client.sendMessage(formattedPhone, message);

        res.json({
            success: true,
            message: `Mensagem enviada via HEADLESS para ${phone} com sucesso!`,
            mode: 'headless',
            timestamp: new Date().toISOString()
        });

    } catch (error) {
        console.error('❌ Erro ao enviar mensagem:', error);
        res.status(500).json({
            success: false,
            error: `Erro HEADLESS: ${error.message}`
        });
    }
});

// Listar chats (mesma funcionalidade)
app.get('/chats', async (req, res) => {
    try {
        if (!isClientReady) {
            return res.status(503).json({
                success: false,
                error: 'WhatsApp HEADLESS não está conectado'
            });
        }

        const chats = await client.getChats();
        const chatList = chats.slice(0, 20).map(chat => ({
            id: chat.id._serialized,
            name: chat.name || 'Chat sem nome',
            isGroup: chat.isGroup,
            unreadCount: chat.unreadCount,
            lastMessage: chat.lastMessage ? {
                body: chat.lastMessage.body.substring(0, 50) + '...',
                timestamp: chat.lastMessage.timestamp
            } : null
        }));

        res.json({
            success: true,
            chats: chatList,
            total: chats.length,
            mode: 'headless'
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
// TRATAMENTO DE ERROS E INICIALIZAÇÃO
// ========================================

process.on('uncaughtException', (error) => {
    console.error('❌ Erro não capturado:', error);
    lastError = `Erro crítico: ${error.message}`;
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('❌ Promise rejeitada:', reason);
    lastError = `Promise rejeitada: ${reason}`;
});

process.on('SIGINT', async () => {
    console.log('🛑 Encerrando bot HEADLESS...');
    if (client) {
        await client.destroy().catch(() => { });
    }
    process.exit(0);
});

// Iniciar servidor
app.listen(PORT, () => {
    console.log(`🌐 Servidor HEADLESS iniciado na porta ${PORT}`);
    console.log(`📋 Interface: http://localhost:${PORT}`);
    console.log(`🤖 Modo: HEADLESS - Sem interface Chrome`);
});

// Inicializar cliente WhatsApp
console.log('🔄 Inicializando cliente WhatsApp HEADLESS...');
initializeClient();
