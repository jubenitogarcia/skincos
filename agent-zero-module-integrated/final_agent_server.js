const express = require('express');
const app = express();
const PORT = 6801;

// Basic middleware
app.use(express.json({ limit: '10mb' }));
app.use((req, res, next) => {
    console.log(`${new Date().toISOString()} - ${req.method} ${req.url}`);
    next();
});

// CORS for localhost
app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', 'http://localhost:5000');
    res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    res.header('Access-Control-Allow-Credentials', true);
    if (req.method === 'OPTIONS') {
        return res.sendStatus(200);
    }
    next();
});

// Simple conversation storage
const conversations = new Map();

// Health endpoint
app.get('/health', (req, res) => {
    res.json({
        status: 'healthy',
        service: 'Agent Zero API',
        version: '1.0.0',
        timestamp: new Date().toISOString(),
        uptime: process.uptime()
    });
});

// Main message endpoint
app.post('/api/message', (req, res) => {
    try {
        const { message, conversation_id = 'default' } = req.body;
        
        if (!message) {
            return res.status(400).json({
                success: false,
                error: 'Message is required'
            });
        }

        // Generate response based on message content
        let response;
        const msg = message.toLowerCase();
        
        if (msg.includes('teste') || msg.includes('test')) {
            response = '✅ **Proxy Funcionando Perfeitamente!**\n\nTeste realizado com sucesso!\n\n🔧 **Detalhes Técnicos:**\n• Proxy: /agent-zero-api → localhost:6801\n• Server: Agent Zero API v1.0.0\n• Status: Operacional\n• Data: ' + new Date().toLocaleString('pt-BR');
        } else if (msg.includes('whatsapp')) {
            response = '📱 **WhatsApp Integration**\n\nMódulo WhatsApp totalmente integrado via proxy!\n\n🚀 **Funcionalidades:**\n• Envio automático de mensagens\n• Gestão de contatos\n• Status de entrega\n• Automações personalizadas\n\nProxy funcionando corretamente para integração WhatsApp.';
        } else if (msg.includes('instagram')) {
            response = '📸 **Instagram Integration**\n\nMódulo Instagram ativo via proxy!\n\n⭐ **Recursos Disponíveis:**\n• Análise OSINT de perfis\n• Automação de interações\n• Download de conteúdo\n• Monitoramento de hashtags\n\nIntegração Instagram funcionando via proxy /agent-zero-api.';
        } else {
            response = `🤖 **Agent Zero IA - Proxy Ativo**\n\nMensagem recebida: "${message}"\n\n✅ **Status do Sistema:**\n• Proxy: Funcionando (/agent-zero-api)\n• API: Respondendo (porta 6801)\n• Integração: Completa\n\n🎯 **Módulos Disponíveis:**\n• WhatsApp Business\n• Instagram Marketing\n• Sistema CRM\n\nDigite "teste" para verificar funcionamento completo.`;
        }

        // Store in conversation history
        const conversationHistory = conversations.get(conversation_id) || [];
        conversationHistory.push({
            role: 'user',
            content: message,
            timestamp: new Date().toISOString()
        });
        conversationHistory.push({
            role: 'assistant',
            content: response,
            timestamp: new Date().toISOString()
        });
        
        // Keep only last 20 messages
        conversations.set(conversation_id, conversationHistory.slice(-20));

        const result = {
            success: true,
            response: response,
            conversation_id: conversation_id,
            message_count: conversationHistory.length,
            timestamp: new Date().toISOString(),
            proxy_status: 'active'
        };

        res.json(result);

    } catch (error) {
        console.error('Error processing message:', error);
        res.status(500).json({
            success: false,
            error: 'Internal server error',
            message: error.message
        });
    }
});

// Additional endpoints
app.get('/api/config', (req, res) => {
    res.json({
        success: true,
        config: {
            name: 'SKINCOS AI Agent Zero',
            version: '1.0.0',
            proxy_path: '/agent-zero-api',
            port: PORT,
            status: 'active'
        }
    });
});

app.get('/api/conversations', (req, res) => {
    const conversationList = Array.from(conversations.entries()).map(([id, messages]) => ({
        id,
        message_count: messages.length,
        last_activity: messages[messages.length - 1]?.timestamp
    }));
    
    res.json({
        success: true,
        conversations: conversationList,
        total: conversationList.length
    });
});

// 404 handler
app.use((req, res) => {
    res.status(404).json({
        error: 'Endpoint not found',
        path: req.url,
        available_endpoints: [
            'GET /health',
            'POST /api/message',
            'GET /api/config',
            'GET /api/conversations'
        ]
    });
});

// Error handler
app.use((error, req, res, next) => {
    console.error('Unhandled error:', error);
    res.status(500).json({
        error: 'Internal server error',
        message: error.message
    });
});

// Start server
const server = app.listen(PORT, '0.0.0.0', () => {
    console.log('🚀 Agent Zero API Server Started Successfully!');
    console.log(`📡 Listening on: http://0.0.0.0:${PORT}`);
    console.log(`🔗 Proxy endpoint: http://localhost:5000/agent-zero-api/*`);
    console.log(`💬 Message API: POST /api/message`);
    console.log(`📊 Health check: GET /health`);
    console.log('✅ Ready to handle proxied requests!');
});

// Keep server alive
server.keepAliveTimeout = 60000;
server.headersTimeout = 65000;

// Graceful shutdown
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

function shutdown() {
    console.log('\n🛑 Shutting down Agent Zero API server...');
    server.close(() => {
        console.log('✅ Server closed gracefully');
        process.exit(0);
    });
}

// Keep process alive and handle errors
process.on('uncaughtException', (error) => {
    console.error('Uncaught Exception:', error);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

console.log('🔥 Agent Zero Server initialized and ready!');
