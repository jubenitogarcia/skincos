// WhatsApp CRM Dashboard JavaScript
class WhatsAppCRM {
    constructor() {
        this.baseURL = window.location.origin;
        this.whatsappAPI = 'http://localhost:3001'; // WhatsApp API base URL
        this.connectionStatus = 'disconnected';
        this.data = {
            contacts: JSON.parse(localStorage.getItem('crm_contacts') || '[]'),
            messages: JSON.parse(localStorage.getItem('crm_messages') || '[]'),
            templates: JSON.parse(localStorage.getItem('crm_templates') || '[]'),
            campaigns: JSON.parse(localStorage.getItem('crm_campaigns') || '[]'),
            stats: {
                totalContacts: 0,
                messagesToday: 0,
                activeChats: 0,
                responseRate: 0
            }
        };
        this.init();
    }

    init() {
        this.setupEventListeners();
        this.loadDashboard();
        this.checkConnectionStatus();
        this.loadInitialData();
        this.checkWhatsAppStatus(); // Check WhatsApp connection status

        // Auto-refresh every 30 seconds
        setInterval(() => {
            this.checkConnectionStatus();
            this.checkWhatsAppStatus();
        }, 30000);
    }

    setupEventListeners() {
        // Form submissions
        document.getElementById('add-contact-form').addEventListener('submit', (e) => this.handleAddContact(e));
        document.getElementById('send-message-form').addEventListener('submit', (e) => this.handleSendMessage(e));
        document.getElementById('campaign-form').addEventListener('submit', (e) => this.handleCreateCampaign(e));
        document.getElementById('template-form').addEventListener('submit', (e) => this.handleCreateTemplate(e));
        document.getElementById('quick-chat-form').addEventListener('submit', (e) => this.handleQuickChat(e));

        // Search functionality
        document.getElementById('contact-search').addEventListener('input', (e) => this.filterContacts(e.target.value));
        document.getElementById('message-search').addEventListener('input', (e) => this.filterMessages(e.target.value));
        document.getElementById('template-search').addEventListener('input', (e) => this.filterTemplates(e.target.value));

        // Message type change
        document.getElementById('message-type').addEventListener('change', (e) => this.toggleMessageUrlField(e.target.value));
    }

    async checkConnectionStatus() {
        try {
            const response = await fetch(`${this.baseURL}/status`);
            const data = await response.json();

            const statusElement = document.getElementById('connection-status');
            if (data.ready) {
                statusElement.innerHTML = `✅ Conectado: ${data.user || 'WhatsApp Ativo'}`;
                statusElement.style.color = '#d4edda';
            } else if (data.qrRequired) {
                statusElement.innerHTML = '📱 QR Code necessário - <a href="/qr.html" target="_blank" style="color: #fff; text-decoration: underline;">Escanear QR</a>';
                statusElement.style.color = '#fff3cd';
            } else {
                const s = data.connState ? `(${data.connState})` : '';
                statusElement.innerHTML = `⏳ Conectando... ${s}`;
                statusElement.style.color = '#fff3cd';
            }
        } catch (error) {
            console.error('Error checking status:', error);
            const statusElement = document.getElementById('connection-status');
            statusElement.innerHTML = '❌ Erro de Conexão';
            statusElement.style.color = '#f8d7da';
        }
    }

    loadDashboard() {
        this.updateStats();
        this.loadRecentActivities();
    }

    loadInitialData() {
        this.renderContacts();
        this.renderMessages();
        this.renderTemplates();
        this.renderCampaigns();
        this.loadAnalytics();
    }

    updateStats() {
        const stats = this.calculateStats();

        document.getElementById('total-contacts').textContent = stats.totalContacts;
        document.getElementById('messages-today').textContent = stats.messagesToday;
        document.getElementById('active-chats').textContent = stats.activeChats;
        document.getElementById('response-rate').textContent = `${stats.responseRate}%`;
    }

    calculateStats() {
        try {
            const today = new Date().toDateString();

            // Safe filter for today's messages
            const messagesToday = this.data.messages.filter(msg => {
                try {
                    if (!msg.timestamp) return false;
                    const msgDate = new Date(msg.timestamp);
                    return !isNaN(msgDate.getTime()) && msgDate.toDateString() === today;
                } catch (error) {
                    console.warn('Invalid message timestamp in calculateStats:', msg.timestamp);
                    return false;
                }
            }).length;

            // Safe filter for active chats
            const activeChats = this.data.messages.filter(msg => {
                try {
                    if (!msg.timestamp) return false;
                    const msgDate = new Date(msg.timestamp);
                    return !isNaN(msgDate.getTime()) && msgDate > new Date(Date.now() - 24 * 60 * 60 * 1000);
                } catch (error) {
                    console.warn('Invalid timestamp in activeChats calculation:', msg.timestamp);
                    return false;
                }
            }).length;

            return {
                totalContacts: this.data.contacts.length || 0,
                messagesToday: messagesToday,
                activeChats: activeChats,
                responseRate: Math.round(Math.random() * 30 + 70) // Mock data for now
            };
        } catch (error) {
            console.error('Error calculating stats:', error);
            return {
                totalContacts: 0,
                messagesToday: 0,
                activeChats: 0,
                responseRate: 0
            };
        }
    }

    loadRecentActivities() {
        const activities = this.getRecentActivities();
        const container = document.getElementById('recent-activities');

        if (activities.length === 0) {
            container.innerHTML = '<p style="color: #666; font-style: italic;">Nenhuma atividade recente</p>';
            return;
        }

        container.innerHTML = activities.map(activity => `
            <div style="padding: 0.5rem 0; border-bottom: 1px solid #eee;">
                <div style="font-size: 0.9rem; color: #333;">${activity.description}</div>
                <div style="font-size: 0.7rem; color: #666;">${this.formatTime(activity.timestamp)}</div>
            </div>
        `).join('');
    }

    getRecentActivities() {
        const activities = [];

        // Recent messages
        this.data.messages.slice(-5).forEach(msg => {
            activities.push({
                description: `💬 Mensagem ${msg.type === 'sent' ? 'enviada para' : 'recebida de'} ${msg.contact}`,
                timestamp: msg.timestamp
            });
        });

        // Recent contacts
        this.data.contacts.slice(-3).forEach(contact => {
            activities.push({
                description: `👤 Novo contato adicionado: ${contact.name}`,
                timestamp: contact.createdAt
            });
        });

        return activities.sort((a, b) => {
            try {
                const dateA = new Date(a.timestamp);
                const dateB = new Date(b.timestamp);

                // Handle invalid dates
                if (isNaN(dateA.getTime()) && isNaN(dateB.getTime())) return 0;
                if (isNaN(dateA.getTime())) return 1;
                if (isNaN(dateB.getTime())) return -1;

                return dateB.getTime() - dateA.getTime();
            } catch (error) {
                console.warn('Error sorting activities by timestamp:', error);
                return 0;
            }
        }).slice(0, 10);
    }

    // Contact Management
    async handleAddContact(e) {
        e.preventDefault();

        try {
            const name = document.getElementById('contact-name').value;
            const phone = document.getElementById('contact-phone').value;
            const email = document.getElementById('contact-email').value;

            // Use Type utility for validation if available
            if (typeof Type !== 'undefined') {
                if (Type.isEmpty(name)) {
                    this.showAlert('error', 'Nome é obrigatório');
                    return;
                }

                if (Type.isEmpty(phone)) {
                    this.showAlert('error', 'Telefone é obrigatório');
                    return;
                }

                if (!Type.isPhone(phone)) {
                    this.showAlert('error', 'Formato de telefone inválido');
                    return;
                }

                if (email && !Type.isEmail(email)) {
                    this.showAlert('error', 'Formato de email inválido');
                    return;
                }
            } else {
                // Fallback validation
                if (!name.trim()) {
                    this.showAlert('error', 'Nome é obrigatório');
                    return;
                }

                if (!phone.trim()) {
                    this.showAlert('error', 'Telefone é obrigatório');
                    return;
                }
            }

            const contact = {
                id: Date.now(),
                name: name.trim(),
                phone: phone.trim(),
                email: email.trim(),
                tags: document.getElementById('contact-tags').value.split(',').map(t => t.trim()).filter(t => t),
                notes: document.getElementById('contact-notes').value,
                createdAt: new Date().toISOString(),
                lastInteraction: null
            };

            this.data.contacts.push(contact);
            this.saveData('contacts');
            this.renderContacts();
            this.updateStats();

            // Reset form
            e.target.reset();

            // Show success notification
            if (typeof useNotificationsByType !== 'undefined') {
                useNotificationsByType('success').show(`Contato ${contact.name} adicionado com sucesso!`);
            } else {
                this.showAlert('success', `✅ Contato "${contact.name}" adicionado com sucesso!`);
            }
        } catch (error) {
            console.error('Error adding contact:', error);
            this.showAlert('error', 'Erro ao adicionar contato. Tente novamente.');
        }
    }

    renderContacts() {
        const container = document.getElementById('contacts-list');

        if (this.data.contacts.length === 0) {
            container.innerHTML = '<p style="color: #666; font-style: italic; text-align: center; padding: 2rem;">Nenhum contato cadastrado</p>';
            return;
        }

        container.innerHTML = `
            <table class="table">
                <thead>
                    <tr>
                        <th>Nome</th>
                        <th>Telefone</th>
                        <th>Tags</th>
                        <th>Ações</th>
                    </tr>
                </thead>
                <tbody>
                    ${this.data.contacts.map(contact => `
                        <tr>
                            <td>${contact.name}</td>
                            <td>${contact.phone}</td>
                            <td>${contact.tags.map(tag => `<span style="background: #e3f2fd; padding: 2px 6px; border-radius: 3px; font-size: 0.8rem; margin-right: 4px;">${tag}</span>`).join('')}</td>
                            <td>
                                <button class="btn" style="padding: 0.25rem 0.5rem; font-size: 0.8rem; margin-right: 0.25rem;" onclick="crm.sendMessageToContact('${contact.phone}')">💬</button>
                                <button class="btn btn-secondary" style="padding: 0.25rem 0.5rem; font-size: 0.8rem;" onclick="crm.deleteContact(${contact.id})">🗑️</button>
                            </td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>
        `;
    }

    filterContacts(query) {
        const filtered = this.data.contacts.filter(contact =>
            contact.name.toLowerCase().includes(query.toLowerCase()) ||
            contact.phone.includes(query) ||
            contact.tags.some(tag => tag.toLowerCase().includes(query.toLowerCase()))
        );

        this.renderFilteredContacts(filtered);
    }

    renderFilteredContacts(contacts) {
        const container = document.getElementById('contacts-list');

        if (contacts.length === 0) {
            container.innerHTML = '<p style="color: #666; font-style: italic; text-align: center; padding: 2rem;">Nenhum contato encontrado</p>';
            return;
        }

        container.innerHTML = `
            <table class="table">
                <thead>
                    <tr>
                        <th>Nome</th>
                        <th>Telefone</th>
                        <th>Tags</th>
                        <th>Ações</th>
                    </tr>
                </thead>
                <tbody>
                    ${contacts.map(contact => `
                        <tr>
                            <td>${contact.name}</td>
                            <td>${contact.phone}</td>
                            <td>${contact.tags.map(tag => `<span style="background: #e3f2fd; padding: 2px 6px; border-radius: 3px; font-size: 0.8rem; margin-right: 4px;">${tag}</span>`).join('')}</td>
                            <td>
                                <button class="btn" style="padding: 0.25rem 0.5rem; font-size: 0.8rem; margin-right: 0.25rem;" onclick="crm.sendMessageToContact('${contact.phone}')">💬</button>
                                <button class="btn btn-secondary" style="padding: 0.25rem 0.5rem; font-size: 0.8rem;" onclick="crm.deleteContact(${contact.id})">🗑️</button>
                            </td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>
        `;
    }

    sendMessageToContact(phone) {
        switchTab('messages');
        document.getElementById('message-phone').value = phone;
        document.getElementById('message-content').focus();
    }

    deleteContact(id) {
        if (confirm('Tem certeza que deseja excluir este contato?')) {
            this.data.contacts = this.data.contacts.filter(c => c.id !== id);
            this.saveData('contacts');
            this.renderContacts();
            this.updateStats();
            this.showAlert('success', '✅ Contato excluído com sucesso!');
        }
    }

    // Message Management
    async handleSendMessage(e) {
        e.preventDefault();

        const messageData = {
            phone: document.getElementById('message-phone').value,
            type: document.getElementById('message-type').value,
            message: document.getElementById('message-content').value,
            url: document.getElementById('message-url').value
        };

        try {
            const response = await fetch(`${this.baseURL}/send`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    number: messageData.phone,
                    type: messageData.type,
                    message: messageData.message,
                    url: messageData.url || undefined
                })
            });

            const result = await response.json();

            if (response.ok) {
                // Add to local message history
                const message = {
                    id: Date.now(),
                    contact: messageData.phone,
                    content: messageData.message,
                    type: 'sent',
                    messageType: messageData.type,
                    timestamp: new Date().toISOString(),
                    status: 'sent'
                };

                this.data.messages.push(message);
                this.saveData('messages');
                this.renderMessages();
                this.updateStats();

                e.target.reset();
                this.showAlert('success', '✅ Mensagem enviada com sucesso!');
            } else {
                this.showAlert('error', `❌ Erro: ${result.error}`);
            }
        } catch (error) {
            this.showAlert('error', `❌ Erro de conexão: ${error.message}`);
        }
    }

    toggleMessageUrlField(type) {
        const urlGroup = document.getElementById('message-url-group');
        urlGroup.style.display = (type === 'image' || type === 'document') ? 'block' : 'none';
    }

    renderMessages() {
        const container = document.getElementById('messages-list');

        if (this.data.messages.length === 0) {
            container.innerHTML = '<p style="color: #666; font-style: italic; text-align: center; padding: 2rem;">Nenhuma mensagem encontrada</p>';
            return;
        }

        const recentMessages = this.data.messages.slice(-20).reverse();

        container.innerHTML = recentMessages.map(msg => `
            <div class="message ${msg.type}">
                <div class="message-meta">
                    <strong>${msg.contact}</strong> • ${this.formatTime(msg.timestamp)} • ${msg.messageType || 'text'}
                </div>
                <div>${msg.content}</div>
            </div>
        `).join('');
    }

    filterMessages(query) {
        const filtered = this.data.messages.filter(msg =>
            msg.contact.includes(query) ||
            msg.content.toLowerCase().includes(query.toLowerCase())
        );

        this.renderFilteredMessages(filtered);
    }

    renderFilteredMessages(messages) {
        const container = document.getElementById('messages-list');

        if (messages.length === 0) {
            container.innerHTML = '<p style="color: #666; font-style: italic; text-align: center; padding: 2rem;">Nenhuma mensagem encontrada</p>';
            return;
        }

        container.innerHTML = messages.slice(-20).reverse().map(msg => `
            <div class="message ${msg.type}">
                <div class="message-meta">
                    <strong>${msg.contact}</strong> • ${this.formatTime(msg.timestamp)} • ${msg.messageType || 'text'}
                </div>
                <div>${msg.content}</div>
            </div>
        `).join('');
    }

    // Campaign Management
    handleCreateCampaign(e) {
        e.preventDefault();

        const campaign = {
            id: Date.now(),
            name: document.getElementById('campaign-name').value,
            message: document.getElementById('campaign-message').value,
            tags: document.getElementById('campaign-tags').value.split(',').map(t => t.trim()).filter(t => t),
            schedule: document.getElementById('campaign-schedule').value,
            createdAt: new Date().toISOString(),
            status: 'pending',
            sent: 0,
            total: 0
        };

        // Calculate recipients
        if (campaign.tags.length > 0) {
            campaign.total = this.data.contacts.filter(contact =>
                contact.tags.some(tag => campaign.tags.includes(tag))
            ).length;
        } else {
            campaign.total = this.data.contacts.length;
        }

        this.data.campaigns.push(campaign);
        this.saveData('campaigns');
        this.renderCampaigns();

        e.target.reset();
        this.showAlert('success', `✅ Campanha "${campaign.name}" criada com sucesso! ${campaign.total} destinatários.`);
    }

    renderCampaigns() {
        const container = document.getElementById('campaigns-list');

        if (this.data.campaigns.length === 0) {
            container.innerHTML = '<p style="color: #666; font-style: italic; text-align: center; padding: 2rem;">Nenhuma campanha criada</p>';
            return;
        }

        container.innerHTML = `
            <table class="table">
                <thead>
                    <tr>
                        <th>Nome</th>
                        <th>Status</th>
                        <th>Progresso</th>
                        <th>Ações</th>
                    </tr>
                </thead>
                <tbody>
                    ${this.data.campaigns.map(campaign => `
                        <tr>
                            <td>
                                <strong>${campaign.name}</strong><br>
                                <small style="color: #666;">${campaign.message.substring(0, 50)}...</small>
                            </td>
                            <td>
                                <span style="background: ${this.getCampaignStatusColor(campaign.status)}; color: white; padding: 2px 8px; border-radius: 12px; font-size: 0.8rem;">
                                    ${this.getCampaignStatusText(campaign.status)}
                                </span>
                            </td>
                            <td>${campaign.sent}/${campaign.total}</td>
                            <td>
                                ${campaign.status === 'pending' ? `<button class="btn" style="padding: 0.25rem 0.5rem; font-size: 0.8rem; margin-right: 0.25rem;" onclick="crm.executeCampaign(${campaign.id})">🚀</button>` : ''}
                                <button class="btn btn-secondary" style="padding: 0.25rem 0.5rem; font-size: 0.8rem;" onclick="crm.deleteCampaign(${campaign.id})">🗑️</button>
                            </td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>
        `;
    }

    getCampaignStatusColor(status) {
        const colors = {
            pending: '#ffc107',
            running: '#007bff',
            completed: '#28a745',
            error: '#dc3545'
        };
        return colors[status] || '#6c757d';
    }

    getCampaignStatusText(status) {
        const texts = {
            pending: 'Pendente',
            running: 'Executando',
            completed: 'Concluída',
            error: 'Erro'
        };
        return texts[status] || 'Desconhecido';
    }

    async executeCampaign(id) {
        const campaign = this.data.campaigns.find(c => c.id === id);
        if (!campaign) return;

        if (!confirm(`Executar campanha "${campaign.name}" para ${campaign.total} contatos?`)) return;

        campaign.status = 'running';
        this.renderCampaigns();

        // Get recipients
        let recipients;
        if (campaign.tags.length > 0) {
            recipients = this.data.contacts.filter(contact =>
                contact.tags.some(tag => campaign.tags.includes(tag))
            );
        } else {
            recipients = this.data.contacts;
        }

        // Send messages with delay
        for (let i = 0; i < recipients.length; i++) {
            const contact = recipients[i];

            try {
                await fetch(`${this.baseURL}/send`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        number: contact.phone,
                        type: 'text',
                        message: campaign.message
                    })
                });

                campaign.sent++;

                // Add to message history
                this.data.messages.push({
                    id: Date.now() + i,
                    contact: contact.phone,
                    content: campaign.message,
                    type: 'sent',
                    messageType: 'campaign',
                    timestamp: new Date().toISOString(),
                    campaignId: campaign.id
                });

                // Update progress every 5 messages
                if (i % 5 === 0) {
                    this.renderCampaigns();
                    this.saveData('campaigns');
                    this.saveData('messages');
                }

                // Wait 2 seconds between messages to avoid rate limiting
                await new Promise(resolve => setTimeout(resolve, 2000));

            } catch (error) {
                console.error('Error sending campaign message:', error);
            }
        }

        campaign.status = 'completed';
        this.saveData('campaigns');
        this.saveData('messages');
        this.renderCampaigns();
        this.showAlert('success', `✅ Campanha "${campaign.name}" executada com sucesso!`);
    }

    deleteCampaign(id) {
        if (confirm('Tem certeza que deseja excluir esta campanha?')) {
            this.data.campaigns = this.data.campaigns.filter(c => c.id !== id);
            this.saveData('campaigns');
            this.renderCampaigns();
            this.showAlert('success', '✅ Campanha excluída com sucesso!');
        }
    }

    // Template Management
    handleCreateTemplate(e) {
        e.preventDefault();

        const template = {
            id: Date.now(),
            name: document.getElementById('template-name').value,
            category: document.getElementById('template-category').value,
            content: document.getElementById('template-content').value,
            variables: document.getElementById('template-variables').value.split(',').map(v => v.trim()).filter(v => v),
            createdAt: new Date().toISOString(),
            usageCount: 0
        };

        this.data.templates.push(template);
        this.saveData('templates');
        this.renderTemplates();

        e.target.reset();
        this.showAlert('success', `✅ Template "${template.name}" criado com sucesso!`);
    }

    renderTemplates() {
        const container = document.getElementById('templates-list');

        if (this.data.templates.length === 0) {
            container.innerHTML = '<p style="color: #666; font-style: italic; text-align: center; padding: 2rem;">Nenhum template criado</p>';
            return;
        }

        container.innerHTML = `
            <div style="display: grid; gap: 1rem;">
                ${this.data.templates.map(template => `
                    <div style="border: 1px solid #ddd; border-radius: 8px; padding: 1rem;">
                        <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 0.5rem;">
                            <h4 style="margin: 0; color: #25D366;">${template.name}</h4>
                            <span style="background: #e9ecef; padding: 2px 8px; border-radius: 12px; font-size: 0.8rem;">${template.category}</span>
                        </div>
                        <p style="margin: 0.5rem 0; color: #666; font-size: 0.9rem;">${template.content}</p>
                        ${template.variables.length > 0 ? `<div style="margin: 0.5rem 0; font-size: 0.8rem; color: #666;">Variáveis: ${template.variables.join(', ')}</div>` : ''}
                        <div style="display: flex; gap: 0.5rem; margin-top: 1rem;">
                            <button class="btn" style="padding: 0.25rem 0.5rem; font-size: 0.8rem;" onclick="crm.useTemplate(${template.id})">📝 Usar</button>
                            <button class="btn btn-secondary" style="padding: 0.25rem 0.5rem; font-size: 0.8rem;" onclick="crm.deleteTemplate(${template.id})">🗑️</button>
                        </div>
                    </div>
                `).join('')}
            </div>
        `;
    }

    filterTemplates(query) {
        const filtered = this.data.templates.filter(template =>
            template.name.toLowerCase().includes(query.toLowerCase()) ||
            template.content.toLowerCase().includes(query.toLowerCase()) ||
            template.category.toLowerCase().includes(query.toLowerCase())
        );

        this.renderFilteredTemplates(filtered);
    }

    renderFilteredTemplates(templates) {
        const container = document.getElementById('templates-list');

        if (templates.length === 0) {
            container.innerHTML = '<p style="color: #666; font-style: italic; text-align: center; padding: 2rem;">Nenhum template encontrado</p>';
            return;
        }

        container.innerHTML = `
            <div style="display: grid; gap: 1rem;">
                ${templates.map(template => `
                    <div style="border: 1px solid #ddd; border-radius: 8px; padding: 1rem;">
                        <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 0.5rem;">
                            <h4 style="margin: 0; color: #25D366;">${template.name}</h4>
                            <span style="background: #e9ecef; padding: 2px 8px; border-radius: 12px; font-size: 0.8rem;">${template.category}</span>
                        </div>
                        <p style="margin: 0.5rem 0; color: #666; font-size: 0.9rem;">${template.content}</p>
                        ${template.variables.length > 0 ? `<div style="margin: 0.5rem 0; font-size: 0.8rem; color: #666;">Variáveis: ${template.variables.join(', ')}</div>` : ''}
                        <div style="display: flex; gap: 0.5rem; margin-top: 1rem;">
                            <button class="btn" style="padding: 0.25rem 0.5rem; font-size: 0.8rem;" onclick="crm.useTemplate(${template.id})">📝 Usar</button>
                            <button class="btn btn-secondary" style="padding: 0.25rem 0.5rem; font-size: 0.8rem;" onclick="crm.deleteTemplate(${template.id})">🗑️</button>
                        </div>
                    </div>
                `).join('')}
            </div>
        `;
    }

    useTemplate(id) {
        const template = this.data.templates.find(t => t.id === id);
        if (!template) return;

        switchTab('messages');
        document.getElementById('message-content').value = template.content;

        template.usageCount++;
        this.saveData('templates');

        this.showAlert('success', `✅ Template "${template.name}" aplicado!`);
    }

    deleteTemplate(id) {
        if (confirm('Tem certeza que deseja excluir este template?')) {
            this.data.templates = this.data.templates.filter(t => t.id !== id);
            this.saveData('templates');
            this.renderTemplates();
            this.showAlert('success', '✅ Template excluído com sucesso!');
        }
    }

    // Analytics
    loadAnalytics() {
        this.loadContactsByTag();
        this.loadWeeklyActivity();
        this.updateAnalyticsStats();
    }

    loadContactsByTag() {
        const tagCounts = {};
        this.data.contacts.forEach(contact => {
            contact.tags.forEach(tag => {
                tagCounts[tag] = (tagCounts[tag] || 0) + 1;
            });
        });

        const container = document.getElementById('contacts-by-tag');
        const sortedTags = Object.entries(tagCounts).sort((a, b) => b[1] - a[1]);

        if (sortedTags.length === 0) {
            container.innerHTML = '<p style="color: #666; font-style: italic;">Nenhuma tag encontrada</p>';
            return;
        }

        container.innerHTML = `
            <div>
                ${sortedTags.map(([tag, count]) => `
                    <div style="display: flex; justify-content: space-between; padding: 0.5rem 0; border-bottom: 1px solid #eee;">
                        <span>${tag}</span>
                        <strong>${count}</strong>
                    </div>
                `).join('')}
            </div>
        `;
    }

    loadWeeklyActivity() {
        const weekDays = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
        const activityData = Array(7).fill(0);

        const oneWeekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

        this.data.messages.forEach(msg => {
            const msgDate = new Date(msg.timestamp);
            if (msgDate >= oneWeekAgo) {
                const dayIndex = msgDate.getDay();
                activityData[dayIndex]++;
            }
        });

        const maxActivity = Math.max(...activityData);
        const container = document.getElementById('weekly-activity');

        container.innerHTML = `
            <div>
                ${weekDays.map((day, index) => {
            const height = maxActivity > 0 ? (activityData[index] / maxActivity) * 100 : 0;
            return `
                        <div style="display: flex; align-items: end; margin-bottom: 0.5rem;">
                            <div style="width: 30px; font-size: 0.8rem;">${day}</div>
                            <div style="flex: 1; background: #f0f0f0; height: 20px; margin: 0 0.5rem; border-radius: 2px; position: relative;">
                                <div style="background: #25D366; height: ${height}%; width: 100%; border-radius: 2px; transition: height 0.3s;"></div>
                            </div>
                            <div style="width: 30px; text-align: right; font-size: 0.8rem;">${activityData[index]}</div>
                        </div>
                    `;
        }).join('')}
            </div>
        `;
    }

    updateAnalyticsStats() {
        const weekStats = this.calculateWeekStats();

        document.getElementById('messages-week').textContent = weekStats.messagesWeek;
        document.getElementById('delivery-rate').textContent = `${weekStats.deliveryRate}%`;
        document.getElementById('avg-response-time').textContent = `${weekStats.avgResponseTime} min`;
        document.getElementById('active-campaigns').textContent = weekStats.activeCampaigns;
    }

    calculateWeekStats() {
        try {
            const oneWeekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

            // Safe filter with date validation
            const messagesWeek = this.data.messages.filter(msg => {
                try {
                    if (!msg.timestamp) return false;
                    const msgDate = new Date(msg.timestamp);
                    return !isNaN(msgDate.getTime()) && msgDate >= oneWeekAgo;
                } catch (error) {
                    console.warn('Invalid message timestamp:', msg.timestamp);
                    return false;
                }
            }).length;

            const activeCampaigns = this.data.campaigns.filter(c =>
                c.status === 'running' || c.status === 'pending'
            ).length;

            return {
                messagesWeek,
                deliveryRate: Math.round(Math.random() * 10 + 90), // Mock data
                avgResponseTime: Math.round(Math.random() * 30 + 15), // Mock data
                activeCampaigns
            };
        } catch (error) {
            console.error('Error calculating week stats:', error);
            return {
                messagesWeek: 0,
                deliveryRate: 0,
                avgResponseTime: 0,
                activeCampaigns: 0
            };
        }
    }

    // Utility functions
    saveData(key) {
        localStorage.setItem(`crm_${key}`, JSON.stringify(this.data[key]));
    }

    formatTime(timestamp) {
        try {
            // Use DateUtils if available, otherwise fallback to safe Date handling
            if (typeof DateUtils !== 'undefined' && DateUtils.formatTime) {
                return DateUtils.formatTime(timestamp);
            }

            // Safe date creation with validation
            const date = timestamp ? new Date(timestamp) : new Date();
            if (isNaN(date.getTime())) {
                console.warn('Invalid timestamp provided to formatTime:', timestamp);
                return 'Data inválida';
            }

            return date.toLocaleString('pt-BR', {
                day: '2-digit',
                month: '2-digit',
                hour: '2-digit',
                minute: '2-digit'
            });
        } catch (error) {
            console.error('Error in formatTime:', error, 'timestamp:', timestamp);
            return 'Erro na data';
        }
    }

    showAlert(type, message) {
        // Remove existing alerts
        const existingAlerts = document.querySelectorAll('.alert');
        existingAlerts.forEach(alert => alert.remove());

        // Create new alert
        const alert = document.createElement('div');
        alert.className = `alert ${type}`;
        alert.innerHTML = message;

        // Insert at top of current tab content
        const activeTab = document.querySelector('.tab-panel.active');
        activeTab.insertBefore(alert, activeTab.firstChild);

        // Auto-remove after 5 seconds
        setTimeout(() => {
            if (alert.parentNode) {
                alert.remove();
            }
        }, 5000);
    }

    // WhatsApp Integration Methods
    async checkWhatsAppStatus() {
        try {
            const response = await fetch(`${this.whatsappAPI}/status`);
            const data = await response.json();
            this.updateWhatsAppUI(data);
        } catch (error) {
            console.error('Error checking WhatsApp status:', error);
            this.updateWhatsAppUI({ ready: false, qrRequired: false, error: true });
        }
    }

    updateWhatsAppUI(status) {
        const statusElement = document.getElementById('whatsapp-status');
        const connectionSection = document.getElementById('connection-section');
        const qrSection = document.getElementById('qr-section');
        const connectedSection = document.getElementById('connected-section');
        const connectBtn = document.getElementById('connect-btn');

        if (status.ready) {
            // Connected
            this.connectionStatus = 'connected';
            statusElement.textContent = '✅ WhatsApp Conectado';
            statusElement.className = 'status-indicator connected';
            connectionSection.style.display = 'none';
            qrSection.style.display = 'none';
            connectedSection.style.display = 'block';
            this.loadConnectedData();
        } else if (status.qrRequired) {
            // QR Code needed
            this.connectionStatus = 'qr-required';
            statusElement.textContent = '📱 QR Code Necessário';
            statusElement.className = 'status-indicator connecting';
            connectionSection.style.display = 'none';
            qrSection.style.display = 'block';
            connectedSection.style.display = 'none';
            this.loadQRCode();
        } else if (status.error) {
            // Error or disconnected
            this.connectionStatus = 'disconnected';
            statusElement.textContent = '❌ WhatsApp Desconectado';
            statusElement.className = 'status-indicator disconnected';
            connectionSection.style.display = 'block';
            qrSection.style.display = 'none';
            connectedSection.style.display = 'none';
            connectBtn.textContent = '🚀 Iniciar Conexão';
        } else {
            // Connecting
            this.connectionStatus = 'connecting';
            statusElement.textContent = '⏳ Conectando...';
            statusElement.className = 'status-indicator connecting';
            connectBtn.textContent = '⏳ Conectando...';
            connectBtn.disabled = true;
        }
    }

    async loadQRCode() {
        try {
            const response = await fetch(`${this.whatsappAPI}/qr`);
            const data = await response.json();

            if (data.success && data.qr) {
                this.displayQR(data.qr);
            } else {
                const qrVisual = document.getElementById('qr-visual');
                qrVisual.innerHTML = '<p>❌ Erro ao carregar QR Code</p>';
            }
        } catch (error) {
            console.error('Error loading QR code:', error);
            const qrVisual = document.getElementById('qr-visual');
            qrVisual.innerHTML = '<p>❌ Erro de conexão</p>';
        }
    }

    displayQR(qrData) {
        const qrVisual = document.getElementById('qr-visual');

        // Try to generate QR code using external API
        const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=280x280&data=${encodeURIComponent(qrData)}`;

        qrVisual.innerHTML = `
            <img src="${qrUrl}" alt="QR Code WhatsApp" style="max-width: 280px; height: auto;">
            <p style="margin-top: 1rem; font-size: 0.9rem; color: #666;">
                Escaneie com seu WhatsApp
            </p>
        `;
    }

    async loadConnectedData() {
        try {
            // Load conversations
            const chatsResponse = await fetch(`${this.whatsappAPI}/chats`);
            const chatsData = await chatsResponse.json();

            if (chatsData.success) {
                this.updateConnectedStats(chatsData.chats);
                this.renderRecentConversations(chatsData.chats.slice(0, 10));
            }

            // Update last sync time
            document.getElementById('last-sync').textContent = new Date().toLocaleTimeString();

        } catch (error) {
            console.error('Error loading connected data:', error);
        }
    }

    updateConnectedStats(chats) {
        const activeChats = chats.filter(chat => !chat.isArchived).length;
        const today = new Date().toDateString();
        const todayMessages = this.data.messages.filter(msg =>
            new Date(msg.timestamp).toDateString() === today
        ).length;

        document.getElementById('active-conversations').textContent = activeChats;
        document.getElementById('messages-count-today').textContent = todayMessages;
    }

    renderRecentConversations(conversations) {
        const container = document.getElementById('recent-conversations');

        if (conversations.length === 0) {
            container.innerHTML = '<p style="text-align: center; color: #666; padding: 2rem;">Nenhuma conversa encontrada</p>';
            return;
        }

        container.innerHTML = conversations.map(chat => `
            <div class="conversation-item" onclick="openConversation('${chat.id._serialized}')">
                <div class="conversation-header">
                    <span class="conversation-name">${chat.name || chat.id.user}</span>
                    <span class="conversation-time">${this.formatTime(chat.timestamp || new Date())}</span>
                </div>
                <div class="conversation-preview">
                    ${chat.lastMessage ? chat.lastMessage.body : 'Nenhuma mensagem'}
                    ${chat.unreadCount > 0 ? `<span class="unread-badge">${chat.unreadCount}</span>` : ''}
                </div>
            </div>
        `).join('');
    }

    async handleQuickChat(e) {
        e.preventDefault();

        const phone = document.getElementById('quick-phone').value;
        const message = document.getElementById('quick-message').value;
        const attachmentType = document.getElementById('attachment-type').value;
        const attachmentUrl = document.getElementById('attachment-url').value;

        try {
            const messageData = {
                number: phone,
                message: message
            };

            if (attachmentType && attachmentUrl) {
                messageData.type = attachmentType;
                messageData.url = attachmentUrl;
            }

            const response = await fetch(`${this.whatsappAPI}/send-message`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(messageData)
            });

            const result = await response.json();

            if (result.success) {
                this.showAlert('success', '✅ Mensagem enviada com sucesso!');
                e.target.reset();
                this.toggleAttachmentField(); // Reset attachment field
                this.loadConnectedData(); // Refresh data
            } else {
                this.showAlert('error', `❌ Erro: ${result.error}`);
            }
        } catch (error) {
            this.showAlert('error', `❌ Erro de conexão: ${error.message}`);
        }
    }

    toggleAttachmentField() {
        const attachmentType = document.getElementById('attachment-type').value;
        const attachmentGroup = document.getElementById('attachment-url-group');

        if (attachmentType && attachmentType !== '') {
            attachmentGroup.style.display = 'block';
        } else {
            attachmentGroup.style.display = 'none';
        }
    }
}

// WhatsApp Global Functions
async function initializeConnection() {
    const connectBtn = document.getElementById('connect-btn');
    connectBtn.textContent = '⏳ Conectando...';
    connectBtn.disabled = true;

    try {
        // Start the WhatsApp client
        const response = await fetch(`${crm.whatsappAPI}/start`, {
            method: 'POST'
        });

        if (response.ok) {
            // Start checking for QR code
            setTimeout(() => crm.checkWhatsAppStatus(), 2000);
        } else {
            crm.showAlert('error', '❌ Erro ao iniciar conexão');
            connectBtn.textContent = '🚀 Iniciar Conexão';
            connectBtn.disabled = false;
        }
    } catch (error) {
        console.error('Error initializing connection:', error);
        crm.showAlert('error', '❌ Erro de conexão com o servidor');
        connectBtn.textContent = '🚀 Iniciar Conexão';
        connectBtn.disabled = false;
    }
}

function refreshQR() {
    crm.loadQRCode();
}

function cancelConnection() {
    const connectionSection = document.getElementById('connection-section');
    const qrSection = document.getElementById('qr-section');
    const connectBtn = document.getElementById('connect-btn');

    connectionSection.style.display = 'block';
    qrSection.style.display = 'none';
    connectBtn.textContent = '🚀 Iniciar Conexão';
    connectBtn.disabled = false;
}

async function syncWhatsApp() {
    crm.showAlert('success', '🔄 Sincronizando dados...');
    await crm.loadConnectedData();
    crm.showAlert('success', '✅ Sincronização concluída!');
}

function newConversation() {
    // Focus on the quick chat phone input
    document.getElementById('quick-phone').focus();
    crm.showAlert('success', '💬 Use o chat rápido abaixo para iniciar uma nova conversa');
}

function exportData() {
    // Export WhatsApp data
    const data = {
        conversations: crm.data.messages,
        contacts: crm.data.contacts,
        timestamp: new Date().toISOString()
    };

    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `whatsapp-export-${new Date().toISOString().split('T')[0]}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    crm.showAlert('success', '📤 Dados exportados com sucesso!');
}

async function disconnectWhatsApp() {
    if (confirm('Tem certeza que deseja desconectar o WhatsApp?')) {
        try {
            const response = await fetch(`${crm.whatsappAPI}/logout`, {
                method: 'POST'
            });

            if (response.ok) {
                crm.connectionStatus = 'disconnected';
                crm.updateWhatsAppUI({ ready: false, qrRequired: false });
                crm.showAlert('success', '🔌 WhatsApp desconectado com sucesso!');
            } else {
                crm.showAlert('error', '❌ Erro ao desconectar');
            }
        } catch (error) {
            console.error('Error disconnecting:', error);
            crm.showAlert('error', '❌ Erro de conexão');
        }
    }
}

function openConversation(chatId) {
    // Open conversation in a new tab or modal
    const url = `${crm.whatsappAPI}/chat/${chatId}`;
    window.open(url, '_blank');
}

function toggleAttachmentField() {
    crm.toggleAttachmentField();
}

// Tab switching function
function switchTab(tabName) {
    // Remove active class from all tabs and panels
    document.querySelectorAll('.tab').forEach(tab => tab.classList.remove('active'));
    document.querySelectorAll('.tab-panel').forEach(panel => panel.classList.remove('active'));

    // Add active class to selected tab and panel
    document.querySelector(`[onclick="switchTab('${tabName}')"]`).classList.add('active');
    document.getElementById(tabName).classList.add('active');

    // Refresh data for specific tabs
    if (tabName === 'analytics') {
        crm.loadAnalytics();
    } else if (tabName === 'whatsapp') {
        crm.checkWhatsAppStatus();
    }
}

// Initialize CRM when page loads
let crm;
document.addEventListener('DOMContentLoaded', () => {
    crm = new WhatsAppCRM();
});
