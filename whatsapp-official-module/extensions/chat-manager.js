class ChatManager {
    constructor(client) {
        this.client = client;
    }

    async getChats() {
        try {
            const chats = await this.client.getChats();
            
            return chats.map(chat => ({
                id: chat.id._serialized,
                name: chat.name,
                isGroup: chat.isGroup,
                unreadCount: chat.unreadCount,
                lastMessage: chat.lastMessage ? {
                    body: chat.lastMessage.body,
                    timestamp: chat.lastMessage.timestamp,
                    from: chat.lastMessage.from
                } : null,
                archived: chat.archived,
                pinned: chat.pinned,
                isMuted: chat.isMuted,
                timestamp: chat.timestamp
            }));
        } catch (error) {
            throw error;
        }
    }

    async getChatById(chatId) {
        try {
            const chat = await this.client.getChatById(chatId);
            
            return {
                id: chat.id._serialized,
                name: chat.name,
                isGroup: chat.isGroup,
                unreadCount: chat.unreadCount,
                lastMessage: chat.lastMessage ? {
                    body: chat.lastMessage.body,
                    timestamp: chat.lastMessage.timestamp,
                    from: chat.lastMessage.from
                } : null,
                archived: chat.archived,
                pinned: chat.pinned,
                isMuted: chat.isMuted,
                timestamp: chat.timestamp
            };
        } catch (error) {
            throw error;
        }
    }

    async getMessages(chatId, limit = 50) {
        try {
            const chat = await this.client.getChatById(chatId);
            const messages = await chat.fetchMessages({ limit });
            
            return messages.map(msg => ({
                id: msg.id._serialized,
                body: msg.body,
                type: msg.type,
                timestamp: msg.timestamp,
                from: msg.from,
                to: msg.to,
                author: msg.author,
                isForwarded: msg.isForwarded,
                hasMedia: msg.hasMedia,
                ack: msg.ack,
                hasReaction: msg.hasReaction
            }));
        } catch (error) {
            throw error;
        }
    }

    async markAsRead(chatId) {
        try {
            const chat = await this.client.getChatById(chatId);
            await chat.sendSeen();
            
            return {
                success: true,
                chatId: chatId
            };
        } catch (error) {
            throw error;
        }
    }

    async archiveChat(chatId, archive = true) {
        try {
            const chat = await this.client.getChatById(chatId);
            await chat.archive(archive);
            
            return {
                success: true,
                chatId: chatId,
                archived: archive
            };
        } catch (error) {
            throw error;
        }
    }

    async pinChat(chatId, pin = true) {
        try {
            const chat = await this.client.getChatById(chatId);
            await chat.pin(pin);
            
            return {
                success: true,
                chatId: chatId,
                pinned: pin
            };
        } catch (error) {
            throw error;
        }
    }

    async muteChat(chatId, unmuteDate) {
        try {
            const chat = await this.client.getChatById(chatId);
            await chat.mute(unmuteDate);
            
            return {
                success: true,
                chatId: chatId,
                mutedUntil: unmuteDate
            };
        } catch (error) {
            throw error;
        }
    }

    async unmuteChat(chatId) {
        try {
            const chat = await this.client.getChatById(chatId);
            await chat.unmute();
            
            return {
                success: true,
                chatId: chatId,
                muted: false
            };
        } catch (error) {
            throw error;
        }
    }

    async deleteChat(chatId) {
        try {
            const chat = await this.client.getChatById(chatId);
            await chat.delete();
            
            return {
                success: true,
                chatId: chatId
            };
        } catch (error) {
            throw error;
        }
    }
}

module.exports = ChatManager;