const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const axios = require('axios');

const app = express();
const PORT = process.env.AGENT_ZERO_PORT || 6800;

// Middleware - Restrict CORS to localhost only for security
app.use(cors({
    origin: ['http://localhost:5000', 'http://127.0.0.1:5000', 'http://localhost:6800', 'http://127.0.0.1:6800'],
    credentials: true
}));
app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'interface')));

// Configuration
let config = {};
try {
    config = JSON.parse(fs.readFileSync('./config/agent_config.json', 'utf8'));
} catch (error) {
    console.error('❌ Failed to load config:', error.message);
    config = { agent_config: { name: "SKINCOS AI Agent", version: "1.0.0" } };
}

// Agent Zero Python Integration
class AgentZeroIntegration {
    constructor() {
        this.pythonProcess = null;
        this.isInitialized = false;
        this.conversations = new Map();
        this.memory = new Map();
    }

    async initialize() {
        try {
            console.log('🤖 Initializing Agent Zero IA...');
            
            // Check Python dependencies
            await this.checkDependencies();
            
            // Initialize memory system
            this.initializeMemory();
            
            this.isInitialized = true;
            console.log('✅ Agent Zero IA initialized successfully');
            
            return { success: true, status: 'initialized' };
        } catch (error) {
            console.error('❌ Agent Zero initialization failed:', error);
            return { success: false, error: error.message };
        }
    }

    async checkDependencies() {
        console.log('🔍 Checking Python dependencies...');
        // In production, would check for required Python packages
        return true;
    }

    initializeMemory() {
        console.log('🧠 Initializing memory system...');
        this.memory.set('system_info', {
            name: config.agent_config.name,
            version: config.agent_config.version,
            started_at: new Date().toISOString(),
            integrations: config.agent_config.integrations
        });
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
            
            // Process with agent (simulated for now)
            const response = await this.generateResponse(message, conversation, context);
            
            // Add assistant response
            const assistantMessage = {
                role: 'assistant', 
                content: response,
                timestamp: new Date().toISOString(),
                actions: []
            };
            
            conversation.push(assistantMessage);
            
            // Store conversation
            this.conversations.set(conversationId, conversation.slice(-20)); // Keep last 20 messages
            
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

    async generateResponse(message, conversation, context) {
        // Advanced AI response generation would go here
        // For now, simulate intelligent responses based on context
        
        const lowerMessage = message.toLowerCase();
        
        // WhatsApp integration
        if (lowerMessage.includes('whatsapp') || context.source === 'whatsapp') {
            if (lowerMessage.includes('status') || lowerMessage.includes('verificar')) {
                try {
                    const whatsappStatus = await this.checkWhatsAppStatus();
                    return `✅ Status WhatsApp: ${whatsappStatus.status || 'Ativo'}\n\nPosso ajudá-lo a gerenciar suas mensagens ou configurar automações.`;
                } catch (error) {
                    return '⚠️ Não foi possível verificar o status do WhatsApp no momento. Como posso ajudá-lo?';
                }
            }
            
            if (lowerMessage.includes('enviar') || lowerMessage.includes('mensagem')) {
                return '📱 Para enviar mensagens via WhatsApp, posso ajudá-lo a:\n\n• Criar mensagens personalizadas\n• Configurar automações\n• Gerenciar listas de contatos\n• Programar envios\n\nMe diga o que você precisa!';
            }
        }
        
        // Instagram integration
        if (lowerMessage.includes('instagram') || context.source === 'instagram') {
            if (lowerMessage.includes('status') || lowerMessage.includes('analise') || lowerMessage.includes('análise')) {
                try {
                    const instaStatus = await this.checkInstagramStatus();
                    return `📸 Status Instagram: ${instaStatus.status || 'Ativo'}\n\nContas configuradas: ${instaStatus.accounts_configured || 0}\n\nPosso ajudá-lo com automação, análises OSINT ou downloads de conteúdo.`;
                } catch (error) {
                    return '⚠️ Não foi possível verificar o status do Instagram no momento. Como posso ajudá-lo?';
                }
            }
            
            if (lowerMessage.includes('automacao') || lowerMessage.includes('automação')) {
                return '🤖 Automação Instagram disponível:\n\n• Like automático em hashtags específicas\n• Follow/unfollow inteligente\n• Comentários programados\n• Análise de engajamento\n• Download de stories/posts\n\nQue tipo de automação você precisa?';
            }
        }
        
        // CRM integration
        if (lowerMessage.includes('crm') || context.source === 'crm') {
            if (lowerMessage.includes('status') || lowerMessage.includes('verificar')) {
                try {
                    const crmStatus = await this.checkCRMStatus();
                    return `📊 Status CRM: ${crmStatus.status || 'Ativo'}\n\nPosso ajudá-lo a gerenciar clientes, vendas e relatórios do seu CRM.`;
                } catch (error) {
                    return '⚠️ Não foi possível verificar o status do CRM no momento. Como posso ajudá-lo?';
                }
            }
            
            if (lowerMessage.includes('cliente') || lowerMessage.includes('vendas')) {
                return '💼 Gestão CRM disponível:\n\n• Cadastro e gestão de clientes\n• Controle de vendas e pipeline\n• Relatórios e analytics\n• Automações de follow-up\n• Integração com WhatsApp e Instagram\n\nQue funcionalidade do CRM você precisa?';
            }
        }
        
        // General system queries
        if (lowerMessage.includes('sistema') || lowerMessage.includes('status') || lowerMessage.includes('ajuda')) {
            return `🎯 **SKINCOS AI - Central de Controle**\n\nEstou aqui para ajudá-lo a gerenciar todos os módulos:\n\n📱 **WhatsApp**: Mensagens e automações\n📸 **Instagram**: Análise OSINT e automação\n📊 **CRM**: Gestão de clientes e vendas\n🔧 **Sistema**: Monitoramento e configurações\n\nO que você gostaria de fazer?`;
        }
        
        // Greeting responses
        if (lowerMessage.includes('oi') || lowerMessage.includes('olá') || lowerMessage.includes('hello') || lowerMessage.includes('hi')) {
            return `👋 Olá! Sou o **SKINCOS AI Agent**, sua IA central para gerenciamento de WhatsApp, Instagram e CRM.\n\nPosso ajudá-lo a:\n• Automatizar mensagens e posts\n• Analisar dados e métricas\n• Gerenciar campanhas\n• Monitorar o sistema\n\nComo posso ajudá-lo hoje?`;
        }
        
        // Default intelligent response
        return `🤖 Entendi sua solicitação. Como sua IA central, posso ajudá-lo a integrar e automatizar processos entre WhatsApp, Instagram e sistemas CRM.\n\nPara melhor atendê-lo, pode me dizer especificamente:\n• Qual módulo você quer gerenciar?\n• Que tipo de automação precisa?\n• Alguma análise específica?\n\nEstou aqui para otimizar seu fluxo de trabalho!`;
    }

    async checkWhatsAppStatus() {
        try {
            const response = await axios.get('http://localhost:3002/api/status', { timeout: 3000 });
            return response.data;
        } catch (error) {
            return { status: 'unknown', error: error.message };
        }
    }

    async checkInstagramStatus() {
        try {
            const response = await axios.get('http://localhost:3003/health', { timeout: 3000 });
            return response.data;
        } catch (error) {
            return { status: 'unknown', error: error.message };
        }
    }

    async checkCRMStatus() {
        try {
            const response = await axios.get('http://localhost:3100/api/status', { timeout: 3000 });
            return response.data;
        } catch (error) {
            return { status: 'unknown', error: error.message };
        }
    }

    async performAction(action, params = {}) {
        console.log(`🎬 Performing action: ${action}`, params);
        
        switch (action) {
            case 'whatsapp_send':
                return await this.whatsappSend(params);
            case 'instagram_post':
                return await this.instagramPost(params);
            case 'system_status':
                return await this.getSystemStatus();
            default:
                return { success: false, error: 'Unknown action' };
        }
    }

    async whatsappSend(params) {
        // Integration with WhatsApp module
        return { success: true, message: 'WhatsApp integration simulated' };
    }

    async instagramPost(params) {
        // Integration with Instagram module
        return { success: true, message: 'Instagram integration simulated' };
    }

    async getSystemStatus() {
        const status = {
            agent_zero: { status: 'healthy', initialized: this.isInitialized },
            whatsapp: await this.checkWhatsAppStatus(),
            instagram: await this.checkInstagramStatus(),
            crm: await this.checkCRMStatus(),
            conversations_active: this.conversations.size,
            memory_entries: this.memory.size,
            uptime: process.uptime()
        };
        
        return { success: true, status };
    }
}

const agentZero = new AgentZeroIntegration();

// Health check endpoint
app.get('/health', async (req, res) => {
    try {
        const status = await agentZero.getSystemStatus();
        res.json({
            status: 'healthy',
            agent_name: config.agent_config.name,
            version: config.agent_config.version,
            initialized: agentZero.isInitialized,
            system_status: status.status,
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        res.status(500).json({
            status: 'unhealthy',
            error: error.message,
            timestamp: new Date().toISOString()
        });
    }
});

// Initialize agent endpoint
app.post('/api/initialize', async (req, res) => {
    try {
        const result = await agentZero.initialize();
        res.json(result);
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
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
        res.status(500).json({ success: false, error: error.message });
    }
});

// Action execution endpoint
app.post('/api/action', async (req, res) => {
    try {
        const { action, params } = req.body;
        
        if (!action) {
            return res.status(400).json({ success: false, error: 'Action is required' });
        }
        
        const result = await agentZero.performAction(action, params || {});
        res.json(result);
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Configuration endpoints
app.get('/api/config', (req, res) => {
    res.json({
        success: true,
        config: config.agent_config
    });
});

app.put('/api/config', (req, res) => {
    try {
        const newConfig = req.body;
        config.agent_config = { ...config.agent_config, ...newConfig };
        
        // Save to file
        fs.writeFileSync('./config/agent_config.json', JSON.stringify({ agent_config: config.agent_config }, null, 2));
        
        res.json({ success: true, config: config.agent_config });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Conversation management
app.get('/api/conversations', (req, res) => {
    const conversations = Array.from(agentZero.conversations.entries()).map(([id, messages]) => ({
        id,
        message_count: messages.length,
        last_message: messages[messages.length - 1]?.timestamp || null
    }));
    
    res.json({ success: true, conversations });
});

app.get('/api/conversations/:id', (req, res) => {
    const conversation = agentZero.conversations.get(req.params.id);
    if (!conversation) {
        return res.status(404).json({ success: false, error: 'Conversation not found' });
    }
    
    res.json({ success: true, conversation });
});

// Memory management
app.get('/api/memory', (req, res) => {
    const memory = Object.fromEntries(agentZero.memory.entries());
    res.json({ success: true, memory });
});

// Webhook endpoint for external integrations
app.post('/webhook/message', async (req, res) => {
    try {
        const { source, message, user_id, conversation_id } = req.body;
        
        // Basic validation for webhook
        if (!message || typeof message !== 'string') {
            return res.status(400).json({ success: false, error: 'Valid message is required' });
        }
        
        if (message.length > 10000) {
            return res.status(400).json({ success: false, error: 'Message too long' });
        }
        
        const context = {
            source: source || 'webhook',
            user_id,
            webhook: true
        };
        
        const result = await agentZero.processMessage(message, conversation_id || user_id, context);
        
        res.json({
            success: true,
            response: result.response,
            conversation_id: result.conversation_id
        });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Admin interface (serve static files)
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
async function startServer() {
    try {
        console.log('🚀 Starting Agent Zero Server...');
        
        // Initialize agent
        await agentZero.initialize();
        
        app.listen(PORT, '0.0.0.0', () => {
            console.log(`🤖 Agent Zero Server running on http://0.0.0.0:${PORT}`);
            console.log(`📊 Health check: http://localhost:${PORT}/health`);
            console.log(`🎯 Admin interface: http://localhost:${PORT}/admin`);
            console.log(`⚙️  Mode: ${config.agent_config.mode || 'development'}`);
        });
    } catch (error) {
        console.error('❌ Failed to start Agent Zero server:', error);
        process.exit(1);
    }
}

// Graceful shutdown
process.on('SIGINT', () => {
    console.log('\n🛑 Agent Zero server shutting down...');
    process.exit(0);
});

process.on('SIGTERM', () => {
    console.log('\n🛑 Agent Zero server shutting down...');
    process.exit(0);
});

// Start the server
startServer();