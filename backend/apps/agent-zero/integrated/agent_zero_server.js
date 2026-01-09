const express = require('express');
const cors = require('cors');
const path = require('path');

const app = express();
const PORT = process.env.AGENT_ZERO_PORT || 6800;

// Middleware - Restrict CORS to localhost only for security
app.use(cors({
    origin: ['http://localhost:5000', 'http://127.0.0.1:5000', 'http://localhost:6800', 'http://127.0.0.1:6800'],
    credentials: true
}));
app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'interface')));

// Simple configuration
const config = {
    agent_config: {
        name: "SKINCOS AI Agent",
        version: "1.0.0",
        mode: "production"
    }
};

// Simple Agent Zero class
class SimpleAgentZero {
    constructor() {
        this.isInitialized = true;
        this.conversations = new Map();
    }

    async processMessage(message, conversationId = 'default', context = {}) {
        try {
            console.log(`💬 Processing message: ${message.substring(0, 100)}...`);
            
            // Get conversation history
            let conversation = this.conversations.get(conversationId) || [];
            
            // Add user message
            const userMessage = {
                role: 'user',
                content: message,
                timestamp: new Date().toISOString(),
                context: context
            };
            
            conversation.push(userMessage);
            
            // Generate response
            const response = this.generateResponse(message, context);
            
            // Add assistant response
            const assistantMessage = {
                role: 'assistant', 
                content: response,
                timestamp: new Date().toISOString()
            };
            
            conversation.push(assistantMessage);
            
            // Store conversation (keep last 20 messages)
            this.conversations.set(conversationId, conversation.slice(-20));
            
            return {
                success: true,
                response: response,
                conversation_id: conversationId,
                message_count: conversation.length
            };
            
        } catch (error) {
            console.error('❌ Error processing message:', error);
            return {
                success: false,
                error: error.message,
                response: 'Desculpe, ocorreu um erro ao processar sua mensagem.'
            };
        }
    }

    generateResponse(message, context) {
        const lowerMessage = message.toLowerCase();
        
        // Generate contextual response based on message content
        if (lowerMessage.includes('whatsapp') || context.source === 'whatsapp') {
            return '📱 **WhatsApp Integration Ativa**\n\nPosso ajudá-lo a:\n• Enviar mensagens automáticas\n• Gerenciar contatos\n• Configurar automações\n• Verificar status da conexão\n\nQue funcionalidade você precisa?';
        }
        
        if (lowerMessage.includes('instagram') || context.source === 'instagram') {
            return '📸 **Instagram Integration Ativa**\n\nRecursos disponíveis:\n• Análise OSINT de perfis\n• Automação de interações\n• Download de conteúdo\n• Monitoramento de hashtags\n\nComo posso ajudar?';
        }
        
        if (lowerMessage.includes('crm') || context.source === 'crm') {
            return '📊 **CRM Integration Ativa**\n\nFuncionalidades:\n• Gestão de clientes\n• Controle de vendas\n• Relatórios detalhados\n• Automações de follow-up\n\nQual operação você deseja realizar?';
        }
        
        if (lowerMessage.includes('sistema') || lowerMessage.includes('status') || lowerMessage.includes('ajuda')) {
            return '🎯 **SKINCOS AI Central**\n\nSistema operacional! Módulos ativos:\n\n📱 **WhatsApp**: Mensagens e automações\n📸 **Instagram**: Análise e automação\n📊 **CRM**: Gestão de clientes\n🔧 **Sistema**: Monitoramento\n\nDigite o que você precisa ou escolha um módulo!';
        }
        
        if (lowerMessage.includes('oi') || lowerMessage.includes('olá') || lowerMessage.includes('hello')) {
            return '👋 **Olá! Bem-vindo ao SKINCOS AI**\n\nSou sua IA central para automação e gestão de:\n• WhatsApp Business\n• Instagram Marketing\n• Sistema CRM\n\n🚀 **Como posso ajudá-lo hoje?**\n\nDigite "ajuda" para ver todas as funcionalidades ou mencione o módulo que precisa (WhatsApp, Instagram, CRM).';
        }
        
        // Default intelligent response
        return `🤖 **SKINCOS AI Agent**\n\nEntendi sua mensagem: "${message.substring(0, 100)}${message.length > 100 ? '...' : ''}"\n\n💡 **Posso ajudá-lo com:**\n• Automação WhatsApp\n• Marketing Instagram\n• Gestão CRM\n• Análises e relatórios\n\nPara melhor atendê-lo, mencione qual módulo você quer usar ou digite "ajuda" para ver todas as opções!`;
    }
}

const agentZero = new SimpleAgentZero();

// Health check endpoint
app.get('/health', (req, res) => {
    res.json({
        status: 'healthy',
        agent_name: config.agent_config.name,
        version: config.agent_config.version,
        initialized: agentZero.isInitialized,
        timestamp: new Date().toISOString()
    });
});

// Message processing endpoint
app.post('/api/message', async (req, res) => {
    try {
        const { message, conversation_id, context } = req.body;
        
        if (!message) {
            return res.status(400).json({ success: false, error: 'Message is required' });
        }
        
        const result = await agentZero.processMessage(message, conversation_id, context || {});
        res.json(result);
    } catch (error) {
        console.error('API Error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Initialize endpoint
app.post('/api/initialize', (req, res) => {
    res.json({ success: true, status: 'initialized', agent: config.agent_config.name });
});

// Configuration endpoint
app.get('/api/config', (req, res) => {
    res.json({
        success: true,
        config: config.agent_config
    });
});

// Conversations endpoint
app.get('/api/conversations', (req, res) => {
    const conversations = Array.from(agentZero.conversations.entries()).map(([id, messages]) => ({
        id,
        message_count: messages.length,
        last_message: messages[messages.length - 1]?.timestamp
    }));
    
    res.json({
        success: true,
        conversations
    });
});

// Admin interface
app.use('/admin', express.static(path.join(__dirname, 'interface')));

// Error handling
app.use((error, req, res, next) => {
    console.error('API Error:', error);
    res.status(500).json({ error: 'Internal server error' });
});

// 404 handler
app.use((req, res) => {
    res.status(404).json({ error: 'Endpoint not found' });
});

// Start server
app.listen(PORT, '0.0.0.0', () => {
    console.log('🚀 Starting Agent Zero Server (Simplified)...');
    console.log(`🤖 Agent Zero Server running on http://0.0.0.0:${PORT}`);
    console.log(`📊 Health check: http://localhost:${PORT}/health`);
    console.log(`🎯 Admin interface: http://localhost:${PORT}/admin`);
    console.log(`⚙️  Mode: ${config.agent_config.mode}`);
    console.log('✅ Agent Zero IA ready for requests');
});

// Graceful shutdown
process.on('SIGINT', () => {
    console.log('\n🛑 Agent Zero server shutting down...');
    process.exit(0);
});

process.on('SIGTERM', () => {
    console.log('\n🛑 Agent Zero server shutting down...');
    process.exit(0);
});