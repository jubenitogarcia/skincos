const express = require('express');
const cors = require('cors');

const app = express();
const PORT = 3001;

// Middlewares
app.use(cors());
app.use(express.json());

// Mock WhatsApp client state
let clientState = {
    ready: false,
    qrRequired: false,
    connecting: false,
    qrCode: null
};

// Generate mock QR code data
function generateMockQR() {
    return '1@AB1234567890,abcdefghijklmnopqrstuvwxyz1234567890,mock-qr-code-data-for-testing';
}

// Mock chat data
const mockChats = [
    {
        id: { _serialized: '5511999999999@c.us', user: '5511999999999' },
        name: 'João Silva',
        timestamp: new Date().getTime(),
        lastMessage: { body: 'Olá! Como você está?' },
        unreadCount: 2,
        isArchived: false
    },
    {
        id: { _serialized: '5511888888888@c.us', user: '5511888888888' },
        name: 'Maria Santos',
        timestamp: new Date().getTime() - 3600000,
        lastMessage: { body: 'Obrigada pelo atendimento!' },
        unreadCount: 0,
        isArchived: false
    },
    {
        id: { _serialized: '5511777777777@c.us', user: '5511777777777' },
        name: 'Pedro Costa',
        timestamp: new Date().getTime() - 7200000,
        lastMessage: { body: 'Quando posso passar aí?' },
        unreadCount: 1,
        isArchived: false
    }
];

// Routes
app.get('/status', (req, res) => {
    res.json({
        success: true,
        ready: clientState.ready,
        qrRequired: clientState.qrRequired,
        status: clientState.ready ? 'ready' : (clientState.qrRequired ? 'qr-required' : 'disconnected'),
        user: clientState.ready ? 'Mock User' : null
    });
});

app.get('/qr', (req, res) => {
    if (clientState.qrRequired) {
        res.json({
            success: true,
            qr: clientState.qrCode || generateMockQR()
        });
    } else {
        res.json({
            success: false,
            error: 'QR not required'
        });
    }
});

app.post('/start', (req, res) => {
    console.log('🚀 Starting WhatsApp connection...');
    
    clientState.connecting = true;
    clientState.ready = false;
    clientState.qrRequired = false;
    
    // Simulate connection process
    setTimeout(() => {
        clientState.qrRequired = true;
        clientState.qrCode = generateMockQR();
        console.log('📱 QR Code generated');
    }, 2000);
    
    // Simulate successful connection after 10 seconds
    setTimeout(() => {
        clientState.ready = true;
        clientState.qrRequired = false;
        clientState.connecting = false;
        console.log('✅ WhatsApp connected successfully');
    }, 10000);
    
    res.json({
        success: true,
        message: 'Connection started'
    });
});

app.post('/logout', (req, res) => {
    console.log('🔌 Disconnecting WhatsApp...');
    
    clientState.ready = false;
    clientState.qrRequired = false;
    clientState.connecting = false;
    clientState.qrCode = null;
    
    res.json({
        success: true,
        message: 'Disconnected successfully'
    });
});

app.get('/chats', (req, res) => {
    if (!clientState.ready) {
        return res.status(503).json({
            success: false,
            error: 'WhatsApp not connected'
        });
    }
    
    res.json({
        success: true,
        chats: mockChats,
        count: mockChats.length
    });
});

app.post('/send-message', (req, res) => {
    if (!clientState.ready) {
        return res.status(503).json({
            success: false,
            error: 'WhatsApp not connected'
        });
    }
    
    const { number, message, type, url } = req.body;
    
    if (!number || !message) {
        return res.status(400).json({
            success: false,
            error: 'Number and message are required'
        });
    }
    
    console.log(`📤 Sending message to ${number}: ${message}`);
    if (type && url) {
        console.log(`📎 Attachment: ${type} - ${url}`);
    }
    
    // Simulate successful message send
    res.json({
        success: true,
        message: 'Message sent successfully',
        to: number,
        content: message,
        type: type || 'text',
        timestamp: new Date().toISOString()
    });
});

app.get('/chat/:chatId', (req, res) => {
    const { chatId } = req.params;
    const chat = mockChats.find(c => c.id._serialized === chatId);
    
    if (chat) {
        res.json({
            success: true,
            chat: chat,
            messages: [
                {
                    id: '1',
                    body: chat.lastMessage.body,
                    from: chatId,
                    timestamp: chat.timestamp,
                    fromMe: false
                }
            ]
        });
    } else {
        res.status(404).json({
            success: false,
            error: 'Chat not found'
        });
    }
});

// Start server
app.listen(PORT, () => {
    console.log('🚀 Mock WhatsApp API Server started');
    console.log(`📱 Server running on port ${PORT}`);
    console.log(`🌐 Status endpoint: http://localhost:${PORT}/status`);
    console.log('');
    console.log('📋 Available endpoints:');
    console.log('   GET  /status        - Check connection status');
    console.log('   GET  /qr            - Get QR code');
    console.log('   POST /start         - Start connection');
    console.log('   POST /logout        - Disconnect');
    console.log('   GET  /chats         - Get chat list');
    console.log('   POST /send-message  - Send message');
    console.log('');
});