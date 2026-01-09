// In-memory storage with tenant scoping (Phase 1 abstraction)
// This will later be replaced / augmented by persistent repositories.

const tenants = {};

function ensureTenant(tenantId = 'default') {
    if (!tenants[tenantId]) {
        tenants[tenantId] = {
            messages: [],        // message records
            contacts: [],        // contacts
            webhooks: [],        // webhooks
            channels: [{ id: 'primary-whatsapp', type: 'whatsapp-web', status: 'online', createdAt: new Date().toISOString(), info: { clientId: 'api-client-prod' } }],
            events: [],          // system events
            annotations: [],     // message annotations
            indexes: {
                messageById: new Map(),            // id -> message
                messagesByChatId: new Map(),       // phone (digits only) -> [messageId]
                messagesByType: new Map(),         // type lowercased -> [messageId]
                contactsById: new Map()            // contact id (digits) -> contact
            }
        };
    }
    return tenants[tenantId];
}

function getStores(tenantId = 'default') {
    return ensureTenant(tenantId);
}

function addMessage(tenantId, msg) {
    const stores = ensureTenant(tenantId);
    stores.messages.push(msg);
    if (msg.id) stores.indexes.messageById.set(msg.id, msg);
    try {
        const type = String(msg.type || '').toLowerCase();
        if (type) {
            const byType = stores.indexes.messagesByType;
            if (!byType.has(type)) byType.set(type, []);
            byType.get(type).push(msg.id);
        }
        const contactIdRaw = (msg.direction === 'inbound' ? (msg.from || '') : (msg.to || ''));
        const phone = String(contactIdRaw || '').replace('@c.us', '').replace(/\D/g, '');
        if (phone) {
            const byChat = stores.indexes.messagesByChatId;
            if (!byChat.has(phone)) byChat.set(phone, []);
            byChat.get(phone).push(msg.id);
        }
    } catch { /* best-effort */ }
    return msg;
}

function getMessage(tenantId, id) {
    const stores = ensureTenant(tenantId);
    return stores.indexes.messageById.get(id) || stores.messages.find(m => m.id === id);
}

module.exports = {
    getStores,
    addMessage,
    getMessage,
    ensureTenant
};
