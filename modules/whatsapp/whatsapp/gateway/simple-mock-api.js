const http = require('http');
const url = require('url');

const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) || 3001 : 3001;

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

// Helper function to parse JSON body
function parseBody(req, callback) {
    let body = '';
    req.on('data', chunk => {
        body += chunk.toString();
    });
    req.on('end', () => {
        try {
            const parsed = body ? JSON.parse(body) : {};
            callback(parsed);
        } catch (error) {
            callback({});
        }
    });
}

// Helper function to send JSON response
function sendJSON(res, data, statusCode = 200) {
    res.writeHead(statusCode, {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization'
    });
    res.end(JSON.stringify(data));
}

// Handle preflight requests
function handleCORS(req, res) {
    if (req.method === 'OPTIONS') {
        res.writeHead(200, {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type, Authorization'
        });
        res.end();
        return true;
    }
    return false;
}

const server = http.createServer((req, res) => {
    if (handleCORS(req, res)) return;

    const parsedUrl = url.parse(req.url, true);
    const path = parsedUrl.pathname;
    const method = req.method;

    console.log(`${method} ${path}`);

    // GET /health (alias of status, minimal output)
    if (method === 'GET' && path === '/health') {
        return sendJSON(res, { success: true, status: clientState.ready ? 'ready' : (clientState.qrRequired ? 'qr-required' : 'disconnected') });
    }

    // GET /v1/health (versioned alias)
    if (method === 'GET' && path === '/v1/health') {
        return sendJSON(res, { success: true, status: clientState.ready ? 'ready' : (clientState.qrRequired ? 'qr-required' : 'disconnected') });
    }

    // GET /status
    if (method === 'GET' && path === '/status') {
        sendJSON(res, {
            success: true,
            ready: clientState.ready,
            qrRequired: clientState.qrRequired,
            status: clientState.ready ? 'ready' : (clientState.qrRequired ? 'qr-required' : 'disconnected'),
            user: clientState.ready ? 'Mock User' : null
        });
        return;
    }

    // GET /v1/status (versioned alias)
    if (method === 'GET' && path === '/v1/status') {
        return sendJSON(res, {
            success: true,
            ready: clientState.ready,
            qrRequired: clientState.qrRequired,
            status: clientState.ready ? 'ready' : (clientState.qrRequired ? 'qr-required' : 'disconnected'),
            user: clientState.ready ? 'Mock User' : null
        });
    }

    // GET /qr
    if (method === 'GET' && path === '/qr') {
        if (clientState.qrRequired) {
            sendJSON(res, {
                success: true,
                qr: clientState.qrCode || generateMockQR()
            });
        } else {
            sendJSON(res, {
                success: false,
                error: 'QR not required'
            });
        }
        return;
    }

    // GET /v1/qr (versioned alias)
    if (method === 'GET' && path === '/v1/qr') {
        if (clientState.qrRequired) {
            return sendJSON(res, { success: true, qr: clientState.qrCode || generateMockQR() });
        }
        return sendJSON(res, { success: false, error: 'QR not required' });
    }

    // POST /start
    if (method === 'POST' && path === '/start') {
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

        sendJSON(res, {
            success: true,
            message: 'Connection started'
        });
        return;
    }

    // POST /v1/start (versioned alias)
    if (method === 'POST' && path === '/v1/start') {
        // forward to /start logic by toggling state similarly
        clientState.connecting = true;
        clientState.ready = false;
        clientState.qrRequired = false;
        setTimeout(() => { clientState.qrRequired = true; clientState.qrCode = generateMockQR(); }, 500);
        setTimeout(() => { clientState.ready = true; clientState.qrRequired = false; clientState.connecting = false; }, 3000);
        return sendJSON(res, { success: true, message: 'Connection started' });
    }

    // POST /logout
    if (method === 'POST' && path === '/logout') {
        console.log('🔌 Disconnecting WhatsApp...');

        clientState.ready = false;
        clientState.qrRequired = false;
        clientState.connecting = false;
        clientState.qrCode = null;

        sendJSON(res, {
            success: true,
            message: 'Disconnected successfully'
        });
        return;
    }

    // POST /v1/logout (versioned alias)
    if (method === 'POST' && path === '/v1/logout') {
        clientState.ready = false;
        clientState.qrRequired = false;
        clientState.connecting = false;
        clientState.qrCode = null;
        return sendJSON(res, { success: true, message: 'Disconnected successfully' });
    }

    // GET /v1/chats/unread-counts (mock)
    if (method === 'GET' && path === '/v1/chats/unread-counts') {
        const counts = {};
        let totalUnread = 0;
        for (const c of mockChats) {
            const id = c.id._serialized;
            if (c.unreadCount > 0) { counts[id] = c.unreadCount; totalUnread += c.unreadCount; }
        }
        return sendJSON(res, { success: true, counts, totalUnread, totalChats: mockChats.length, timestamp: new Date().toISOString() });
    }

    // GET /v1/search (mock unified search)
    if (method === 'GET' && path === '/v1/search') {
        const { q = '', limit = '5' } = parsedUrl.query || {};
        const lim = Math.max(0, Math.min(50, parseInt(limit, 10) || 5));

        // very simple filter by name or number
        const needle = String(q).toLowerCase();
        const contacts = mockChats
            .filter(c => !needle || c.name.toLowerCase().includes(needle) || c.id.user.includes(needle))
            .slice(0, lim)
            .map(c => ({
                id: c.id._serialized,
                user: c.id.user,
                name: c.name,
                unreadCount: c.unreadCount,
                lastMessage: c.lastMessage?.body || null,
                timestamp: c.timestamp
            }));

        // fabricate simple message hits
        const messages = contacts.map((c, i) => ({
            id: `m_${i + 1}`,
            chatId: c.id,
            body: c.lastMessage || 'Mensagem',
            fromMe: false,
            timestamp: c.timestamp
        }));

        return sendJSON(res, {
            meta: {
                query: String(q),
                limit: lim,
                totalContacts: contacts.length,
                totalMessages: messages.length,
                ts: new Date().toISOString()
            },
            contacts,
            messages
        });
    }

    // GET /v1/chats (versioned alias)
    if (method === 'GET' && path === '/v1/chats') {
        if (!clientState.ready) {
            return sendJSON(res, { success: false, error: 'WhatsApp not connected' }, 503);
        }
        return sendJSON(res, { success: true, chats: mockChats, count: mockChats.length });
    }

    // GET /chats
    if (method === 'GET' && path === '/chats') {
        if (!clientState.ready) {
            sendJSON(res, {
                success: false,
                error: 'WhatsApp not connected'
            }, 503);
            return;
        }

        sendJSON(res, {
            success: true,
            chats: mockChats,
            count: mockChats.length
        });
        return;
    }

    // POST /v1/messages/send (versioned canonical)
    if (method === 'POST' && path === '/v1/messages/send') {
        if (!clientState.ready) {
            return sendJSON(res, { success: false, error: 'WhatsApp not connected' }, 503);
        }
        parseBody(req, (body) => {
            const { number, message, type, url: mediaUrl } = body;
            if (!number || !message) {
                return sendJSON(res, { success: false, error: 'Number and message are required' }, 400);
            }
            return sendJSON(res, {
                success: true,
                message: 'Message sent successfully',
                to: number,
                content: message,
                type: type || 'text',
                mediaUrl: mediaUrl || null,
                timestamp: new Date().toISOString()
            });
        });
        return;
    }

    // POST /send-message
    if (method === 'POST' && path === '/send-message') {
        if (!clientState.ready) {
            sendJSON(res, {
                success: false,
                error: 'WhatsApp not connected'
            }, 503);
            return;
        }

        parseBody(req, (body) => {
            const { number, message, type, url } = body;

            if (!number || !message) {
                sendJSON(res, {
                    success: false,
                    error: 'Number and message are required'
                }, 400);
                return;
            }

            console.log(`📤 Sending message to ${number}: ${message}`);
            if (type && url) {
                console.log(`📎 Attachment: ${type} - ${url}`);
            }

            sendJSON(res, {
                success: true,
                message: 'Message sent successfully',
                to: number,
                content: message,
                type: type || 'text',
                timestamp: new Date().toISOString()
            });
        });
        return;
    }

    // GET /chat/:chatId
    if (method === 'GET' && path.startsWith('/chat/')) {
        const chatId = path.split('/')[2];
        const chat = mockChats.find(c => c.id._serialized === chatId);

        if (chat) {
            sendJSON(res, {
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
            sendJSON(res, {
                success: false,
                error: 'Chat not found'
            }, 404);
        }
        return;
    }

    // GET /v1/avatar/:chatId (mock avatar JSON)
    if (method === 'GET' && path.startsWith('/v1/avatar/')) {
        const chatId = path.split('/')[3] || '';
        return sendJSON(res, {
            success: true,
            chatId,
            avatarUrl: `https://via.placeholder.com/64?text=${encodeURIComponent(chatId.slice(0, 2) || 'U')}`
        });
    }

    // GET /v1/media/:mediaId (mock media proxy JSON)
    if (method === 'GET' && path.startsWith('/v1/media/')) {
        const mediaId = path.split('/')[3] || '';
        return sendJSON(res, {
            success: true,
            mediaId,
            mediaUrl: `https://via.placeholder.com/600x400?text=${encodeURIComponent(mediaId || 'media')}`
        });
    }

    // POST /v1/dev/simulate-inbound (no-op ack)
    if (method === 'POST' && path === '/v1/dev/simulate-inbound') {
        parseBody(req, (body) => {
            // Optionally bump unread for the first chat to simulate activity
            if (mockChats.length > 0) {
                mockChats[0].unreadCount = (mockChats[0].unreadCount || 0) + 1;
            }
            return sendJSON(res, { success: true, received: body || {}, ts: new Date().toISOString() });
        });
        return;
    }

    // GET /v1/instance (basic instance info)
    if (method === 'GET' && path === '/v1/instance') {
        return sendJSON(res, {
            success: true,
            port: PORT,
            status: clientState.ready ? 'ready' : (clientState.qrRequired ? 'qr-required' : 'disconnected'),
            ready: clientState.ready
        });
    }

    // 404 for unknown routes
    sendJSON(res, {
        success: false,
        error: 'Not found'
    }, 404);
});

server.listen(PORT, () => {
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
