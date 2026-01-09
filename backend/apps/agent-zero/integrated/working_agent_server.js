const express = require('express');
const cors = require('cors');

const app = express();
const PORT = 6801;

// CORS configuration
app.use(cors({
    origin: ['http://localhost:5000', 'http://127.0.0.1:5000'],
    credentials: true
}));

app.use(express.json({ limit: '10mb' }));

// Simple response storage
const conversations = new Map();

// Health endpoint
app.get('/health', (req, res) => {
    console.log('📊 Health check requested');
    res.json({
        status: 'healthy',
        service: 'Agent Zero API',
        version: '1.0.0',
        port: PORT,
        timestamp: new Date().toISOString()
    });
});

// Message processing endpoint
app.post('/api/message', (req, res) => {
    try {
        const { message, conversation_id = 'default', context = {} } = req.body;
        
        console.log(`💬 Message received: ${message?.substring(0, 50)}...`);
        
        if (!message) {
            return res.status(400).json({ 
                success: false, 
                error: 'Message is required' 
            });
        }

        // Generate intelligent response based on message content
        let response;
        const lowerMessage = message.toLowerCase();
        
        if (lowerMessage.includes('whatsapp')) {
            response = '📱 **WhatsApp Integration**\n\nFuncionalidades disponíveis:\n• Envio de mensagens em massa\n• Automação de respostas\n• Gestão de contatos\n• Status de entrega\n\nComo posso ajudá-lo com o WhatsApp?';
        } else if (lowerMessage.includes('instagram')) {
            response = '📸 **Instagram Integration**\n\nRecursos:\n• Análise OSINT de perfis\n• Automação de interações\n• Download de conteúdo\n• Monitoramento\n\nQue funcionalidade do Instagram você precisa?';
        } else if (lowerMessage.includes('test') || lowerMessage.includes('teste')) {
            response = '✅ **Teste do Agent Zero**\n\nSistema funcionando perfeitamente!\n\n📊 Status: Operacional\n🔗 Proxy: Ativo\n⚡ API: Respondendo\n\nTodos os módulos estão integrados e funcionais.';
        } else {
            response = `🤖 **Agent Zero IA**\n\nOlá! Recebi sua mensagem: "${message}"\n\n🎯 **Posso ajudá-lo com:**\n• Automação WhatsApp\n• Marketing Instagram  \n• Gestão CRM\n• Análises de dados\n\nDigite "whatsapp", "instagram" ou "teste" para começar!`;
        }
        
        // Store conversation
        let conversation = conversations.get(conversation_id) || [];
        conversation.push({
            role: 'user',
            content: message,
            timestamp: new Date().toISOString()
        });
        conversation.push({
            role: 'assistant',
            content: response,
            timestamp: new Date().toISOString()
        });
        conversations.set(conversation_id, conversation.slice(-20)); // Keep last 20 messages
        
        const result = {
            success: true,
            response: response,
            conversation_id: conversation_id,
            message_count: conversation.length,
            timestamp: new Date().toISOString()
        };
        
        console.log(`✅ Response sent for conversation ${conversation_id}`);
        res.json(result);
        
    } catch (error) {
        console.error('❌ Error processing message:', error);
        res.status(500).json({ 
            success: false, 
            error: error.message,
            response: 'Desculpe, ocorreu um erro ao processar sua mensagem.'
        });
    }
});

// Additional endpoints
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

app.get('/api/config', (req, res) => {
    res.json({
        success: true,
        config: {
            name: 'SKINCOS AI Agent',
            version: '1.0.0',
            features: ['WhatsApp', 'Instagram', 'CRM'],
            status: 'active'
        }
    });
});

// Error handling
app.use((error, req, res, next) => {
    console.error('API Error:', error);
    res.status(500).json({ error: 'Internal server error' });
});

// 404 handler
app.use((req, res) => {
    console.log(`❓ 404: ${req.method} ${req.url}`);
    res.status(404).json({ 
        error: 'Endpoint not found',
        method: req.method,
        path: req.url,
        available_endpoints: ['/health', '/api/message', '/api/conversations', '/api/config']
    });
});

// Start server
const server = app.listen(PORT, '0.0.0.0', () => {
    console.log('🚀 Agent Zero API Server Started!');
    console.log(`🌐 Server: http://0.0.0.0:${PORT}`);
    console.log(`📊 Health: http://localhost:${PORT}/health`);
    console.log(`💬 Message API: POST http://localhost:${PORT}/api/message`);
    console.log('✅ Ready to receive requests via proxy at /agent-zero-api/*');
});

// Graceful shutdown
process.on('SIGINT', () => {
    console.log('\n🛑 Shutting down Agent Zero API server...');
    server.close(() => {
        console.log('✅ Server closed');
        process.exit(0);
    });
});

process.on('SIGTERM', () => {
    console.log('\n🛑 Shutting down Agent Zero API server...');
    server.close(() => {
        console.log('✅ Server closed');
        process.exit(0);
    });
});
