class ContactManager {
    constructor(client) {
        this.client = client;
    }

    async getContacts() {
        try {
            const contacts = await this.client.getContacts();
            
            return contacts.map(contact => ({
                id: contact.id._serialized,
                number: contact.number,
                name: contact.name,
                pushname: contact.pushname,
                shortName: contact.shortName,
                isMyContact: contact.isMyContact,
                isUser: contact.isUser,
                isGroup: contact.isGroup,
                isWAContact: contact.isWAContact,
                isBlocked: contact.isBlocked,
                isBusiness: contact.isBusiness,
                isEnterprise: contact.isEnterprise,
                labels: contact.labels || [],
                isMe: contact.isMe
            }));
        } catch (error) {
            throw error;
        }
    }

    async getContactById(contactId) {
        try {
            const contact = await this.client.getContactById(contactId);
            
            return {
                id: contact.id._serialized,
                number: contact.number,
                name: contact.name,
                pushname: contact.pushname,
                shortName: contact.shortName,
                isMyContact: contact.isMyContact,
                isUser: contact.isUser,
                isGroup: contact.isGroup,
                isWAContact: contact.isWAContact,
                isBlocked: contact.isBlocked,
                isBusiness: contact.isBusiness,
                isEnterprise: contact.isEnterprise,
                labels: contact.labels || [],
                isMe: contact.isMe
            };
        } catch (error) {
            throw error;
        }
    }

    async getProfilePicUrl(contactId) {
        try {
            const contact = await this.client.getContactById(contactId);
            const url = await contact.getProfilePicUrl();
            
            return {
                contactId: contactId,
                profilePicUrl: url
            };
        } catch (error) {
            throw error;
        }
    }

    async blockContact(contactId) {
        try {
            const contact = await this.client.getContactById(contactId);
            await contact.block();
            
            return {
                success: true,
                contactId: contactId,
                blocked: true
            };
        } catch (error) {
            throw error;
        }
    }

    async unblockContact(contactId) {
        try {
            const contact = await this.client.getContactById(contactId);
            await contact.unblock();
            
            return {
                success: true,
                contactId: contactId,
                blocked: false
            };
        } catch (error) {
            throw error;
        }
    }

    async getCommonGroups(contactId) {
        try {
            const contact = await this.client.getContactById(contactId);
            const groupIds = await contact.getCommonGroups();
            
            const groups = [];
            for (const groupId of groupIds) {
                const chat = await this.client.getChatById(groupId);
                groups.push({
                    id: chat.id._serialized,
                    name: chat.name
                });
            }
            
            return {
                contactId: contactId,
                commonGroups: groups
            };
        } catch (error) {
            throw error;
        }
    }

    async getAbout(contactId) {
        try {
            const contact = await this.client.getContactById(contactId);
            const about = await contact.getAbout();
            
            return {
                contactId: contactId,
                about: about
            };
        } catch (error) {
            throw error;
        }
    }

    async isRegisteredUser(phoneNumber) {
        try {
            const numberId = phoneNumber.includes('@c.us') ? phoneNumber : `${phoneNumber}@c.us`;
            const isRegistered = await this.client.isRegisteredUser(numberId);
            
            return {
                phoneNumber: phoneNumber,
                isRegistered: isRegistered
            };
        } catch (error) {
            throw error;
        }
    }

    async getNumberId(phoneNumber) {
        try {
            const numberId = await this.client.getNumberId(phoneNumber);
            
            return {
                phoneNumber: phoneNumber,
                numberId: numberId ? numberId._serialized : null,
                exists: !!numberId
            };
        } catch (error) {
            throw error;
        }
    }
}

module.exports = ContactManager;