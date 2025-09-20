const express = require('express');
const cors = require('cors');

// Servidor de teste simplificado para verificar se a API funciona
const app = express();

// Configurações básicas
app.use(cors());
app.use(express.json());

// Mock do Channel Management API
const mockChannels = new Map();
const mockLicenses = new Set(['DEFAULT_LICENSE_001']);

// Rota de sistema status
app.get('/api/channel-manager/system/status', (req, res) => {
    res.json({
        success: true,
        system: {
            status: 'running',
            uptime: process.uptime(),
            timestamp: new Date().toISOString()
        },
        channels: {
            active: mockChannels.size,
            max: 5
        },
        licenses: {
            total: mockLicenses.size
        }
    });
});

// Rota de licenças
app.get('/api/channel-manager/licenses', (req, res) => {
    res.json({
        success: true,
        count: mockLicenses.size,
        licenses: Array.from(mockLicenses).map(key => ({
            key: key.slice(-3), // Show only last 3 chars
            type: 'premium',
            active: true
        }))
    });
});

// Rota de canais
app.get('/api/channel-manager/channels', (req, res) => {
    res.json({
        success: true,
        count: mockChannels.size,
        maxChannels: 5,
        channels: Array.from(mockChannels.entries()).map(([id, channel]) => ({
            channelId: id,
            status: channel.status,
            createdAt: channel.createdAt
        }))
    });
});

// Ativar canal
app.post('/api/channel-manager/channels/:channelId/activate', (req, res) => {
    const { channelId } = req.params;
    const { licenseKey } = req.body;
    
    if (!licenseKey || !mockLicenses.has(licenseKey)) {
        return res.status(400).json({ success: false, error: 'Invalid license key' });
    }
    
    if (mockChannels.has(channelId)) {
        return res.status(400).json({ success: false, error: 'Channel already active' });
    }
    
    mockChannels.set(channelId, {
        status: 'ready',
        licenseKey,
        createdAt: new Date().toISOString(),
        lastActivity: new Date().toISOString()
    });
    
    res.json({
        success: true,
        channelId,
        status: 'activated',
        message: `Channel ${channelId} activated successfully`
    });
});

// Status específico do canal
app.get('/whatsapp/:channelId/status', (req, res) => {
    const { channelId } = req.params;
    
    if (!mockChannels.has(channelId)) {
        return res.status(404).json({ success: false, error: 'Channel not found' });
    }
    
    const channel = mockChannels.get(channelId);
    res.json({
        success: true,
        channelId,
        status: channel.status,
        ready: channel.status === 'ready',
        lastActivity: channel.lastActivity
    });
});

// QR code do canal
app.get('/whatsapp/:channelId/qr', (req, res) => {
    const { channelId } = req.params;
    
    if (!mockChannels.has(channelId)) {
        return res.status(404).json({ success: false, error: 'Channel not found' });
    }
    
    res.json({
        success: true,
        channelId,
        qr: 'MOCK_QR_CODE_FOR_TESTING',
        status: 'qr_available',
        hasQR: true
    });
});

// Enviar mensagem
app.post('/whatsapp/:channelId/send-message', (req, res) => {
    const { channelId } = req.params;
    const { number, message } = req.body;
    
    if (!mockChannels.has(channelId)) {
        return res.status(404).json({ success: false, error: 'Channel not found' });
    }
    
    if (!number || !message) {
        return res.status(400).json({ success: false, error: 'Number and message are required' });
    }
    
    res.json({
        success: true,
        channelId,
        messageId: 'MOCK_MSG_' + Date.now(),
        timestamp: new Date().toISOString(),
        to: number,
        message: message
    });
});

// Listar chats
app.get('/whatsapp/:channelId/chats', (req, res) => {
    const { channelId } = req.params;
    
    if (!mockChannels.has(channelId)) {
        return res.status(404).json({ success: false, error: 'Channel not found' });
    }
    
    res.json({
        success: true,
        channelId,
        count: 2,
        chats: [
            {
                id: 'chat1@c.us',
                name: 'Contato Test 1',
                lastMessage: 'Última mensagem',
                timestamp: new Date().toISOString()
            },
            {
                id: 'chat2@c.us', 
                name: 'Contato Test 2',
                lastMessage: 'Outra mensagem',
                timestamp: new Date().toISOString()
            }
        ]
    });
});

// Listar contatos
app.get('/whatsapp/:channelId/contacts', (req, res) => {
    const { channelId } = req.params;
    
    if (!mockChannels.has(channelId)) {
        return res.status(404).json({ success: false, error: 'Channel not found' });
    }
    
    res.json({
        success: true,
        channelId,
        count: 3,
        contacts: [
            {
                id: 'contact1@c.us',
                name: 'João Silva',
                number: '+5511999999999'
            },
            {
                id: 'contact2@c.us',
                name: 'Maria Santos',
                number: '+5511888888888'
            },
            {
                id: 'contact3@c.us',
                name: 'Pedro Costa',
                number: '+5511777777777'
            }
        ]
    });
});

// Desativar canal
app.delete('/api/channel-manager/channels/:channelId', (req, res) => {
    const { channelId } = req.params;
    
    if (!mockChannels.has(channelId)) {
        return res.status(404).json({ success: false, error: 'Channel not found' });
    }
    
    mockChannels.delete(channelId);
    
    res.json({
        success: true,
        channelId,
        status: 'deactivated',
        message: `Channel ${channelId} deactivated successfully`
    });
});

const PORT = process.env.WHATSAPP_PORT || 3001;
app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Mock WhatsApp API server running on port ${PORT}`);
    console.log(`📱 Test URL: http://localhost:${PORT}/api/channel-manager/system/status`);
    console.log(`📋 Available endpoints:`);
    console.log(`   GET    /api/channel-manager/system/status`);
    console.log(`   GET    /api/channel-manager/licenses`);
    console.log(`   GET    /api/channel-manager/channels`);
    console.log(`   POST   /api/channel-manager/channels/:id/activate`);
    console.log(`   DELETE /api/channel-manager/channels/:id`);
    console.log(`   GET    /whatsapp/:channelId/status`);
    console.log(`   GET    /whatsapp/:channelId/qr`);
    console.log(`   POST   /whatsapp/:channelId/send-message`);
    console.log(`   GET    /whatsapp/:channelId/chats`);
    console.log(`   GET    /whatsapp/:channelId/contacts`);
});