/**
 * SKINCOS AI Instagram Module - Dashboard JavaScript
 * Frontend interface for Instagram automation and OSINT platform
 */

class InstagramDashboard {
    constructor() {
        this.apiBase = '/instagram-api';
        this.token = this.getAuthToken();
        this.refreshInterval = null;
        
        this.init();
    }
    
    init() {
        console.log('🚀 Instagram Dashboard initialized');
        
        // Set up form event listeners
        this.setupEventListeners();
        
        // Load initial data
        this.loadSystemStatus();
        this.loadRecentActivity();
        
        // Set up auto-refresh
        this.refreshInterval = setInterval(() => {
            this.loadSystemStatus();
            this.loadRecentActivity();
        }, 30000); // Refresh every 30 seconds
    }
    
    setupEventListeners() {
        // Add Account Form
        document.getElementById('addAccountForm').addEventListener('submit', (e) => {
            e.preventDefault();
            this.addAccount();
        });
        
        // OSINT Form
        document.getElementById('osintForm').addEventListener('submit', (e) => {
            e.preventDefault();
            this.startOsintInvestigation();
        });
        
        // Download Form
        document.getElementById('downloadForm').addEventListener('submit', (e) => {
            e.preventDefault();
            this.startContentDownload();
        });
        
        // Automation Form
        document.getElementById('automationForm').addEventListener('submit', (e) => {
            e.preventDefault();
            this.startAutomation();
        });
        
        // Upload Form
        document.getElementById('uploadForm').addEventListener('submit', (e) => {
            e.preventDefault();
            this.uploadContent();
        });
        
        // Modal close on background click
        document.querySelectorAll('.modal').forEach(modal => {
            modal.addEventListener('click', (e) => {
                if (e.target === modal) {
                    this.closeModal(modal.id);
                }
            });
        });
    }
    
    getAuthToken() {
        // Get JWT token from localStorage or sessionStorage
        return localStorage.getItem('admin_token') || sessionStorage.getItem('admin_token') || 'development-token';
    }
    
    async apiRequest(endpoint, options = {}) {
        const defaultOptions = {
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${this.token}`
            }
        };
        
        // Handle FormData (for file uploads)
        if (options.body instanceof FormData) {
            delete defaultOptions.headers['Content-Type'];
        }
        
        const response = await fetch(`${this.apiBase}${endpoint}`, {
            ...defaultOptions,
            ...options
        });
        
        if (!response.ok) {
            const error = await response.json().catch(() => ({ message: 'Network error' }));
            throw new Error(error.message || `HTTP ${response.status}`);
        }
        
        return await response.json();
    }
    
    async loadSystemStatus() {
        try {
            const health = await this.apiRequest('/health');
            
            // Update status indicators
            document.getElementById('accounts-count').textContent = health.accounts_configured || 0;
            document.getElementById('active-sessions').textContent = health.active_sessions || 0;
            
            // Load additional stats
            await this.loadAdditionalStats();
            
        } catch (error) {
            console.error('Failed to load system status:', error);
            this.showToast('Erro ao carregar status do sistema', 'error');
        }
    }
    
    async loadAdditionalStats() {
        try {
            // Count OSINT investigations (mock for now)
            document.getElementById('osint-investigations').textContent = Math.floor(Math.random() * 50);
            
            // Count content downloads (mock for now)
            document.getElementById('content-downloads').textContent = Math.floor(Math.random() * 200);
            
        } catch (error) {
            console.error('Failed to load additional stats:', error);
        }
    }
    
    async loadRecentActivity() {
        try {
            const resultsContent = document.getElementById('results-content');
            
            // For now, show a placeholder table
            // In production, this would load actual recent activities
            resultsContent.innerHTML = `
                <table class="results-table">
                    <thead>
                        <tr>
                            <th>Atividade</th>
                            <th>Alvo</th>
                            <th>Status</th>
                            <th>Data</th>
                            <th>Ações</th>
                        </tr>
                    </thead>
                    <tbody>
                        <tr>
                            <td>Investigação OSINT</td>
                            <td>@usuario_exemplo</td>
                            <td><span class="badge badge-success">Concluído</span></td>
                            <td>Há 2 horas</td>
                            <td><button class="btn-secondary">Ver</button></td>
                        </tr>
                        <tr>
                            <td>Download de Conteúdo</td>
                            <td>@perfil_target</td>
                            <td><span class="badge badge-warning">Processando</span></td>
                            <td>Há 5 minutos</td>
                            <td><button class="btn-secondary">Ver</button></td>
                        </tr>
                        <tr>
                            <td>Automação</td>
                            <td>Hashtags: #photography</td>
                            <td><span class="badge badge-success">Ativo</span></td>
                            <td>Há 1 hora</td>
                            <td><button class="btn-secondary">Parar</button></td>
                        </tr>
                    </tbody>
                </table>
            `;
            
        } catch (error) {
            console.error('Failed to load recent activity:', error);
            document.getElementById('results-content').innerHTML = `
                <p style="text-align: center; color: #6b7280; padding: 40px;">
                    Erro ao carregar atividades recentes
                </p>
            `;
        }
    }
    
    async addAccount() {
        try {
            const username = document.getElementById('username').value;
            const password = document.getElementById('password').value;
            const accountId = document.getElementById('account_id').value || null;
            
            const response = await this.apiRequest('/accounts', {
                method: 'POST',
                body: JSON.stringify({
                    username,
                    password,
                    account_id: accountId
                })
            });
            
            this.showToast('Conta adicionada com sucesso!', 'success');
            this.closeModal('addAccountModal');
            this.loadSystemStatus();
            
            // Clear form
            document.getElementById('addAccountForm').reset();
            
        } catch (error) {
            console.error('Failed to add account:', error);
            this.showToast(`Erro ao adicionar conta: ${error.message}`, 'error');
        }
    }
    
    async startOsintInvestigation() {
        try {
            const username = document.getElementById('osint_username').value;
            const deepAnalysis = document.getElementById('deep_analysis').checked;
            
            const response = await this.apiRequest('/osint/investigate', {
                method: 'POST',
                body: JSON.stringify({
                    username,
                    deep_analysis: deepAnalysis
                })
            });
            
            if (deepAnalysis) {
                this.showToast('Investigação OSINT iniciada em segundo plano', 'info');
            } else {
                this.showToast('Investigação OSINT concluída', 'success');
            }
            
            this.closeModal('osintModal');
            this.loadRecentActivity();
            
            // Clear form
            document.getElementById('osintForm').reset();
            
        } catch (error) {
            console.error('Failed to start OSINT investigation:', error);
            this.showToast(`Erro na investigação OSINT: ${error.message}`, 'error');
        }
    }
    
    async startContentDownload() {
        try {
            const username = document.getElementById('download_username').value;
            const maxItems = parseInt(document.getElementById('max_items').value);
            
            const contentTypes = [];
            if (document.getElementById('download_posts').checked) contentTypes.push('posts');
            if (document.getElementById('download_stories').checked) contentTypes.push('stories');
            if (document.getElementById('download_highlights').checked) contentTypes.push('highlights');
            
            const response = await this.apiRequest('/download/content', {
                method: 'POST',
                body: JSON.stringify({
                    username,
                    content_types: contentTypes,
                    max_items: maxItems
                })
            });
            
            this.showToast('Download de conteúdo iniciado em segundo plano', 'info');
            this.closeModal('downloadModal');
            this.loadRecentActivity();
            
            // Clear form
            document.getElementById('downloadForm').reset();
            
        } catch (error) {
            console.error('Failed to start content download:', error);
            this.showToast(`Erro no download: ${error.message}`, 'error');
        }
    }
    
    async startAutomation() {
        try {
            const accountId = document.getElementById('automation_account').value;
            const hashtagsStr = document.getElementById('target_hashtags').value;
            const maxLikes = parseInt(document.getElementById('max_likes').value);
            const maxFollows = parseInt(document.getElementById('max_follows').value);
            
            const targetHashtags = hashtagsStr.split(',').map(tag => tag.trim()).filter(tag => tag);
            
            const response = await this.apiRequest('/automation/engage', {
                method: 'POST',
                body: JSON.stringify({
                    account_id: accountId,
                    target_hashtags: targetHashtags,
                    max_likes: maxLikes,
                    max_follows: maxFollows
                })
            });
            
            this.showToast('Automação iniciada em segundo plano', 'info');
            this.closeModal('automationModal');
            this.loadRecentActivity();
            
            // Clear form
            document.getElementById('automationForm').reset();
            
        } catch (error) {
            console.error('Failed to start automation:', error);
            this.showToast(`Erro na automação: ${error.message}`, 'error');
        }
    }
    
    async uploadContent() {
        try {
            const accountId = document.getElementById('upload_account').value;
            const image = document.getElementById('upload_image').files[0];
            const caption = document.getElementById('upload_caption').value;
            const hashtagsStr = document.getElementById('upload_hashtags').value;
            
            const hashtags = hashtagsStr.split(',').map(tag => tag.trim()).filter(tag => tag);
            
            const formData = new FormData();
            formData.append('account_id', accountId);
            formData.append('caption', caption);
            formData.append('hashtags', JSON.stringify(hashtags));
            formData.append('image', image);
            
            const response = await this.apiRequest('/upload/post', {
                method: 'POST',
                body: formData
            });
            
            this.showToast('Post publicado com sucesso!', 'success');
            this.closeModal('uploadModal');
            this.loadRecentActivity();
            
            // Clear form
            document.getElementById('uploadForm').reset();
            
        } catch (error) {
            console.error('Failed to upload content:', error);
            this.showToast(`Erro no upload: ${error.message}`, 'error');
        }
    }
    
    async loadAccounts() {
        try {
            const response = await this.apiRequest('/accounts');
            
            // Populate account dropdowns
            const automationSelect = document.getElementById('automation_account');
            const uploadSelect = document.getElementById('upload_account');
            
            // Clear existing options
            automationSelect.innerHTML = '<option value="">Selecione uma conta...</option>';
            uploadSelect.innerHTML = '<option value="">Selecione uma conta...</option>';
            
            response.accounts.forEach(account => {
                const option = `<option value="${account.account_id}">${account.username}</option>`;
                automationSelect.innerHTML += option;
                uploadSelect.innerHTML += option;
            });
            
            // Show accounts list if needed
            if (response.accounts.length === 0) {
                this.showToast('Nenhuma conta configurada', 'warning');
            }
            
        } catch (error) {
            console.error('Failed to load accounts:', error);
            this.showToast(`Erro ao carregar contas: ${error.message}`, 'error');
        }
    }
    
    openModal(modalId) {
        const modal = document.getElementById(modalId);
        modal.classList.add('active');
        
        // Load accounts when opening automation or upload modals
        if (modalId === 'automationModal' || modalId === 'uploadModal') {
            this.loadAccounts();
        }
    }
    
    closeModal(modalId) {
        const modal = document.getElementById(modalId);
        modal.classList.remove('active');
    }
    
    showToast(message, type = 'info') {
        // Remove existing toast
        const existingToast = document.querySelector('.toast');
        if (existingToast) {
            existingToast.remove();
        }
        
        // Create new toast
        const toast = document.createElement('div');
        toast.className = `toast ${type}`;
        toast.textContent = message;
        
        document.body.appendChild(toast);
        
        // Show toast
        setTimeout(() => {
            toast.classList.add('show');
        }, 100);
        
        // Hide toast after 4 seconds
        setTimeout(() => {
            toast.classList.remove('show');
            setTimeout(() => {
                if (toast.parentNode) {
                    toast.remove();
                }
            }, 300);
        }, 4000);
    }
    
    refreshResults() {
        this.loadRecentActivity();
        this.showToast('Resultados atualizados', 'success');
    }
    
    viewOsintResults() {
        // Placeholder for OSINT results viewer
        this.showToast('Visualizador de resultados OSINT em desenvolvimento', 'info');
    }
    
    viewDownloads() {
        // Placeholder for downloads viewer
        this.showToast('Visualizador de downloads em desenvolvimento', 'info');
    }
    
    viewAutomationResults() {
        // Placeholder for automation results viewer
        this.showToast('Visualizador de automação em desenvolvimento', 'info');
    }
    
    viewAnalytics() {
        // Placeholder for analytics viewer
        this.showToast('Dashboard de analytics em desenvolvimento', 'info');
    }
    
    // Cleanup method
    destroy() {
        if (this.refreshInterval) {
            clearInterval(this.refreshInterval);
        }
    }
}

// Global functions for onclick handlers
function openModal(modalId) {
    window.instagramDashboard.openModal(modalId);
}

function closeModal(modalId) {
    window.instagramDashboard.closeModal(modalId);
}

function loadAccounts() {
    window.instagramDashboard.loadAccounts();
}

function refreshResults() {
    window.instagramDashboard.refreshResults();
}

function viewOsintResults() {
    window.instagramDashboard.viewOsintResults();
}

function viewDownloads() {
    window.instagramDashboard.viewDownloads();
}

function viewAutomationResults() {
    window.instagramDashboard.viewAutomationResults();
}

function viewAnalytics() {
    window.instagramDashboard.viewAnalytics();
}

// Initialize dashboard when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    window.instagramDashboard = new InstagramDashboard();
    
    console.log('📸 SKINCOS AI Instagram Module Dashboard Ready');
});

// Cleanup on page unload
window.addEventListener('beforeunload', () => {
    if (window.instagramDashboard) {
        window.instagramDashboard.destroy();
    }
});