// API client for Enterprise WhatsApp API endpoints
const API = {
    baseURL: '/v1',
    
    // Generic request handler
    async request(endpoint, options = {}) {
        try {
            const response = await fetch(`${this.baseURL}${endpoint}`, {
                headers: {
                    'Content-Type': 'application/json',
                    'Accept': 'application/json',
                    ...options.headers
                },
                ...options
            });
            
            const data = await response.json();
            
            if (!response.ok) {
                throw new Error(data.details || data.error || `HTTP ${response.status}`);
            }
            
            return data;
        } catch (error) {
            console.error(`API Error [${endpoint}]:`, error);
            throw error;
        }
    },

    // Health and system endpoints
    async getHealth() {
        return this.request('/health');
    },

    async getQueueStats() {
        return this.request('/queue/stats');
    },

    // Messages endpoints
    messages: {
        // Send a message
        async send(messageData) {
            return API.request('/messages', {
                method: 'POST',
                body: JSON.stringify(messageData)
            });
        },

        // Get messages with filters
        async list(filters = {}) {
            const params = new URLSearchParams();
            Object.keys(filters).forEach(key => {
                if (filters[key] !== undefined && filters[key] !== '') {
                    params.append(key, filters[key]);
                }
            });
            
            const queryString = params.toString();
            return API.request(`/messages${queryString ? '?' + queryString : ''}`);
        },

        // Get message by ID
        async get(id) {
            return API.request(`/messages/${id}`);
        },

        // Update message status
        async updateStatus(id, status, reason) {
            return API.request(`/messages/${id}/status`, {
                method: 'PUT',
                body: JSON.stringify({ status, reason })
            });
        },

        // Send bulk messages
        async bulk(messages) {
            return API.request('/messages/bulk', {
                method: 'POST',
                body: JSON.stringify({ messages })
            });
        },

        // Schedule message
        async schedule(messageData) {
            return API.request('/messages/schedule', {
                method: 'POST',
                body: JSON.stringify(messageData)
            });
        },

        // Search messages
        async search(query, filters = {}) {
            const params = new URLSearchParams({
                query,
                ...filters
            });
            return API.request(`/messages/search?${params.toString()}`);
        },

        // Add AI annotation
        async addAnnotation(id, annotation) {
            return API.request(`/messages/${id}/annotations`, {
                method: 'POST',
                body: JSON.stringify(annotation)
            });
        }
    },

    // Contacts endpoints
    contacts: {
        // List contacts
        async list(filters = {}) {
            const params = new URLSearchParams();
            Object.keys(filters).forEach(key => {
                if (filters[key] !== undefined && filters[key] !== '') {
                    params.append(key, filters[key]);
                }
            });
            
            const queryString = params.toString();
            return API.request(`/contacts${queryString ? '?' + queryString : ''}`);
        },

        // Create contact
        async create(contactData) {
            return API.request('/contacts', {
                method: 'POST',
                body: JSON.stringify(contactData)
            });
        },

        // Get contact by ID
        async get(id) {
            return API.request(`/contacts/${id}`);
        },

        // Update contact
        async update(id, contactData) {
            return API.request(`/contacts/${id}`, {
                method: 'PUT',
                body: JSON.stringify(contactData)
            });
        },

        // Sync contacts
        async sync(contacts) {
            return API.request('/contacts/sync', {
                method: 'POST',
                body: JSON.stringify({ contacts })
            });
        },

        // Add tags to contact
        async addTags(id, tags) {
            return API.request(`/contacts/${id}/tags`, {
                method: 'POST',
                body: JSON.stringify({ tags })
            });
        },

        // Remove tag from contact
        async removeTag(id, tag) {
            return API.request(`/contacts/${id}/tags/${tag}`, {
                method: 'DELETE'
            });
        },

        // Get contact statistics
        async getStats() {
            return API.request('/contacts/statistics');
        }
    },

    // Templates endpoints
    templates: {
        // List templates
        async list(filters = {}) {
            const params = new URLSearchParams();
            Object.keys(filters).forEach(key => {
                if (filters[key] !== undefined && filters[key] !== '') {
                    params.append(key, filters[key]);
                }
            });
            
            const queryString = params.toString();
            return API.request(`/message_templates${queryString ? '?' + queryString : ''}`);
        },

        // Create template
        async create(templateData) {
            return API.request('/message_templates', {
                method: 'POST',
                body: JSON.stringify(templateData)
            });
        },

        // Get template by ID
        async get(id) {
            return API.request(`/message_templates/${id}`);
        },

        // Update template
        async update(id, templateData) {
            return API.request(`/message_templates/${id}`, {
                method: 'PUT',
                body: JSON.stringify(templateData)
            });
        },

        // Submit template for approval
        async submit(id) {
            return API.request(`/message_templates/${id}/submit`, {
                method: 'POST'
            });
        }
    },

    // Campaigns endpoints
    campaigns: {
        // List campaigns
        async list(filters = {}) {
            const params = new URLSearchParams();
            Object.keys(filters).forEach(key => {
                if (filters[key] !== undefined && filters[key] !== '') {
                    params.append(key, filters[key]);
                }
            });
            
            const queryString = params.toString();
            return API.request(`/campaigns${queryString ? '?' + queryString : ''}`);
        },

        // Create campaign
        async create(campaignData) {
            return API.request('/campaigns', {
                method: 'POST',
                body: JSON.stringify(campaignData)
            });
        },

        // Get campaign by ID
        async get(id) {
            return API.request(`/campaigns/${id}`);
        },

        // Start campaign
        async start(id) {
            return API.request(`/campaigns/${id}/start`, {
                method: 'POST'
            });
        },

        // Pause campaign
        async pause(id) {
            return API.request(`/campaigns/${id}/pause`, {
                method: 'POST'
            });
        },

        // Resume campaign
        async resume(id) {
            return API.request(`/campaigns/${id}/resume`, {
                method: 'POST'
            });
        },

        // Stop campaign
        async stop(id) {
            return API.request(`/campaigns/${id}/stop`, {
                method: 'POST'
            });
        }
    },

    // Segments endpoints
    segments: {
        // List segments
        async list(filters = {}) {
            const params = new URLSearchParams();
            Object.keys(filters).forEach(key => {
                if (filters[key] !== undefined && filters[key] !== '') {
                    params.append(key, filters[key]);
                }
            });
            
            const queryString = params.toString();
            return API.request(`/segments${queryString ? '?' + queryString : ''}`);
        },

        // Create segment
        async create(segmentData) {
            return API.request('/segments', {
                method: 'POST',
                body: JSON.stringify(segmentData)
            });
        },

        // Get segment by ID
        async get(id) {
            return API.request(`/segments/${id}`);
        },

        // Update segment
        async update(id, segmentData) {
            return API.request(`/segments/${id}`, {
                method: 'PUT',
                body: JSON.stringify(segmentData)
            });
        },

        // Refresh segment cache
        async refresh(id) {
            return API.request(`/segments/${id}/refresh`, {
                method: 'POST'
            });
        },

        // Test segment query
        async testQuery(queryData) {
            return API.request('/segments/test-query', {
                method: 'POST',
                body: JSON.stringify(queryData)
            });
        }
    },

    // Webhooks endpoints
    webhooks: {
        // List webhooks
        async list() {
            return API.request('/webhooks');
        },

        // Register webhook
        async create(webhookData) {
            return API.request('/webhooks', {
                method: 'POST',
                body: JSON.stringify(webhookData)
            });
        },

        // Remove webhook
        async remove(id) {
            return API.request(`/webhooks/${id}`, {
                method: 'DELETE'
            });
        },

        // Test webhook
        async test(webhookData) {
            return API.request('/webhooks/test', {
                method: 'POST',
                body: JSON.stringify(webhookData)
            });
        },

        // Get webhook deliveries
        async getDeliveries(id) {
            return API.request(`/webhooks/${id}/deliveries`);
        }
    },

    // Dashboard stats (aggregated data)
    dashboard: {
        async getStats() {
            // Get data from multiple endpoints for dashboard
            try {
                const [health, queueStats, messageStats] = await Promise.all([
                    API.getHealth(),
                    API.getQueueStats().catch(() => ({ queue_mode: 'unknown', queue_health: {} })),
                    API.messages.list({ limit: 1 }).catch(() => ({ total: 0, messages: [] }))
                ]);

                return {
                    health,
                    queueStats,
                    messageStats,
                    timestamp: new Date().toISOString()
                };
            } catch (error) {
                console.error('Error fetching dashboard stats:', error);
                throw error;
            }
        },

        async getRecentActivity() {
            try {
                const messages = await API.messages.list({ 
                    limit: 20,
                    offset: 0 
                });

                return {
                    messages: messages.messages || [],
                    total: messages.total || 0
                };
            } catch (error) {
                console.error('Error fetching recent activity:', error);
                return { messages: [], total: 0 };
            }
        }
    }
};