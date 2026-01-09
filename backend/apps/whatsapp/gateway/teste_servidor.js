console.log('🚀 Testando servidor simples...');

const express = require('express');
const app = express();
const PORT = 3001;

app.use(express.json());

// Página inicial com informações da interface
app.get('/', (req, res) => {
    res.send(`
    <!DOCTYPE html>
    <html lang="pt-BR">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>WhatsApp Bot API - Interface Web</title>
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
        </style>
    </head>
    <body>
        <div class="container">
            <div class="header">
                <h1>🚀 WhatsApp Bot API - Interface Web</h1>
                <p>Sistema de automação WhatsApp com API REST</p>
            </div>

            <div class="section">
                <h2>📊 Status do Sistema</h2>
                <div class="status waiting" id="status">
                    ⏳ Sistema de teste ativo - WhatsApp Bot não conectado
                </div>
            </div>

            <div class="section">
                <h2>🌐 URLs Disponíveis</h2>
                <div class="endpoint">
                    <strong>Interface Principal:</strong> <code>http://localhost:3001</code><br>
                    📋 Esta página - Documentação e testes da API
                </div>
                <div class="endpoint">
                    <strong>API Status:</strong> <code>GET /status</code><br>
                    📊 Verificar status de conexão do bot
                </div>
                <div class="endpoint">
                    <strong>Enviar Mensagem:</strong> <code>POST /send</code><br>
                    📱 Enviar mensagens via API
                </div>
                <div class="endpoint">
                    <strong>Listar Chats:</strong> <code>GET /chats</code><br>
                    💬 Obter lista de conversas
                </div>
            </div>

            <div class="section">
                <h2>🧪 Teste de API</h2>
                <div class="form-group">
                    <label for="phone">Número (com código do país):</label>
                    <input type="text" id="phone" placeholder="+5551995103563" value="+5551995103563">
                </div>
                <div class="form-group">
                    <label for="message">Mensagem:</label>
                    <textarea id="message" rows="3" placeholder="Digite sua mensagem...">Teste de mensagem via interface web</textarea>
                </div>
                <button onclick="sendMessage()">📱 Enviar Mensagem</button>
                <div id="result" style="margin-top: 15px;"></div>
            </div>

            <div class="section">
                <h2>📖 Exemplos de Uso</h2>
                <div class="endpoint">
                    <strong>cURL - Verificar Status:</strong><br>
                    <code>curl http://localhost:3001/status</code>
                </div>
                <div class="endpoint">
                    <strong>cURL - Enviar Mensagem:</strong><br>
                    <code>curl -X POST http://localhost:3001/send \\<br>
                    &nbsp;&nbsp;-H "Content-Type: application/json" \\<br>
                    &nbsp;&nbsp;-d '{"phone": "+5551995103563", "message": "Teste via API"}'</code>
                </div>
            </div>

            <div class="section">
                <h2>🔧 Como Iniciar o Bot Completo</h2>
                <p>Para ativar todas as funcionalidades, execute no terminal:</p>
                <div class="endpoint">
                    <code>cd &lt;seu_repositorio&gt;/skincos/whatsapp-gateway</code><br>
                    <code>node bot_com_api.js</code>
                </div>
                <p>Após a inicialização, escaneie o QR Code com seu WhatsApp e recarregue esta página.</p>
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
                        result.innerHTML = '<div class="status ready">✅ Mensagem enviada com sucesso!</div>';
                    } else {
                        result.innerHTML = '<div class="status error">❌ Erro: ' + (data.error || 'Erro desconhecido') + '</div>';
                    }
                } catch (error) {
                    result.innerHTML = '<div class="status error">❌ Erro de conexão: Bot WhatsApp não está rodando</div>';
                }
            }

            // Verificar status a cada 5 segundos
            setInterval(async () => {
                try {
                    const response = await fetch('/status');
                    const data = await response.json();
                    const statusDiv = document.getElementById('status');

                    if (data.ready) {
                        statusDiv.className = 'status ready';
                        statusDiv.innerHTML = '✅ WhatsApp Bot conectado e pronto!';
                    } else {
                        statusDiv.className = 'status waiting';
                        statusDiv.innerHTML = '⏳ WhatsApp Bot inicializando...';
                    }
                } catch (error) {
                    const statusDiv = document.getElementById('status');
                    statusDiv.className = 'status waiting';
                    statusDiv.innerHTML = '⏳ Sistema de teste ativo - WhatsApp Bot não conectado';
                }
            }, 5000);
        </script>
    </body>
    </html>
    `);
});

// Endpoint de status simples
app.get('/status', (req, res) => {
    res.json({
        ready: false,
        message: 'Bot de teste - WhatsApp não conectado',
        timestamp: new Date().toISOString()
    });
});

// Endpoint de teste para envio
app.post('/send', (req, res) => {
    res.status(503).json({
        success: false,
        error: 'WhatsApp Bot não está conectado. Execute: node bot_com_api.js'
    });
});

app.listen(PORT, () => {
    console.log(`✅ Servidor de teste rodando em http://localhost:${PORT}`);
    console.log('🌐 Acesse http://localhost:3001 no seu navegador');
    console.log('📖 Para funcionalidade completa, execute: node bot_com_api.js');
});
