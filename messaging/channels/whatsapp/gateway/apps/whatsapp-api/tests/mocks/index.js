/**
 * Mock utilities for WhatsApp API testing
 * Provides standardized mock objects for testing
 */

const crypto = require('crypto');

/**
 * Creates a mock WhatsApp client for testing
 * @param {Object} options - Options for the mock client
 * @returns {Object} Mock client object
 */
function createMockClient(options = {}) {
    const defaults = {
        info: {
            wid: {
                _serialized: '1234567890@c.us',
                user: '1234567890'
            },
            pushname: 'Test Bot',
            me: {
                _serialized: '1234567890@c.us',
                user: '1234567890'
            }
        },
        ready: true,
        authenticated: true
    };

    return {
        ...defaults,
        ...options,
        
        // Mock methods
        initialize: () => Promise.resolve(),
        destroy: () => Promise.resolve(),
        sendMessage: () => Promise.resolve({
            id: {
                _serialized: `false_${Date.now()}_${crypto.randomUUID()}`,
                id: crypto.randomUUID()
            },
            body: 'Mock message sent',
            type: 'chat',
            timestamp: Date.now()
        }),
        getChatById: () => Promise.resolve(createMockChat()),
        getContacts: () => Promise.resolve([createMockContact()]),
        getChats: () => Promise.resolve([createMockChat()])
    };
}

/**
 * Creates a mock WhatsApp message for testing
 * @param {Object} options - Message options
 * @returns {Object} Mock message object
 */
function createMockMessage(options = {}) {
    const defaults = {
        id: {
            _serialized: `false_${Date.now()}_${crypto.randomUUID()}`,
            id: crypto.randomUUID()
        },
        body: 'Test message',
        type: 'chat',
        timestamp: Date.now(),
        from: '1234567890@c.us',
        to: '0987654321@c.us',
        author: null,
        deviceType: 'web',
        isForwarded: false,
        isStarred: false,
        hasQuotedMsg: false,
        hasMedia: false
    };

    const message = { ...defaults, ...options };

    // Mock methods
    message.getChat = () => Promise.resolve(createMockChat());
    message.getContact = () => Promise.resolve(createMockContact());
    message.getInfo = () => Promise.resolve({
        delivery: [],
        read: [],
        played: []
    });
    message.reply = (text) => Promise.resolve(createMockMessage({
        body: text,
        hasQuotedMsg: true
    }));
    message.star = () => Promise.resolve();
    message.unstar = () => Promise.resolve();

    return message;
}

/**
 * Creates a mock WhatsApp chat for testing
 * @param {Object} options - Chat options
 * @returns {Object} Mock chat object
 */
function createMockChat(options = {}) {
    const defaults = {
        id: {
            _serialized: '1234567890@c.us',
            user: '1234567890'
        },
        name: 'Test Chat',
        isGroup: false,
        timestamp: Date.now(),
        unreadCount: 0,
        lastMessage: null,
        isArchived: false,
        isMuted: false,
        isReadOnly: false
    };

    const chat = { ...defaults, ...options };

    // Mock methods
    chat.sendMessage = (message) => Promise.resolve(createMockMessage({
        body: message,
        from: chat.id._serialized
    }));
    chat.getContact = () => Promise.resolve(createMockContact());
    chat.fetchMessages = () => Promise.resolve([createMockMessage()]);
    chat.archive = () => Promise.resolve();
    chat.unarchive = () => Promise.resolve();
    chat.mute = () => Promise.resolve();
    chat.unmute = () => Promise.resolve();

    return chat;
}

/**
 * Creates a mock WhatsApp contact for testing
 * @param {Object} options - Contact options
 * @returns {Object} Mock contact object
 */
function createMockContact(options = {}) {
    const defaults = {
        id: {
            _serialized: '1234567890@c.us',
            user: '1234567890'
        },
        name: 'Test Contact',
        pushname: 'Test Contact',
        shortName: 'Test',
        number: '1234567890',
        isMe: false,
        isUser: true,
        isGroup: false,
        isWAContact: true,
        isMyContact: true,
        isBlocked: false
    };

    const contact = { ...defaults, ...options };

    // Mock methods
    contact.getChat = () => Promise.resolve(createMockChat());
    contact.getProfilePicUrl = () => Promise.resolve('https://example.com/profile.jpg');
    contact.block = () => Promise.resolve();
    contact.unblock = () => Promise.resolve();

    return contact;
}

/**
 * Creates mock API response for testing
 * @param {Object} data - Response data
 * @param {boolean} success - Whether the response is successful
 * @returns {Object} Mock API response
 */
function createMockApiResponse(data = {}, success = true) {
    return {
        success,
        data: success ? data : null,
        error: success ? null : (data.message || 'Mock error'),
        timestamp: new Date().toISOString()
    };
}

/**
 * Sleep utility for testing
 * @param {number} ms - Milliseconds to sleep
 * @returns {Promise} Promise that resolves after the specified time
 */
function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Creates a mock webhook payload
 * @param {Object} options - Webhook payload options
 * @returns {Object} Mock webhook payload
 */
function createMockWebhookPayload(options = {}) {
    const defaults = {
        event: 'message_received',
        timestamp: Date.now(),
        data: {
            message: createMockMessage(),
            contact: createMockContact()
        }
    };

    return { ...defaults, ...options };
}

module.exports = {
    createMockClient,
    createMockMessage,
    createMockChat,
    createMockContact,
    createMockApiResponse,
    createMockWebhookPayload,
    sleep
};