// Utility functions for the admin interface
const utils = {
    // Format numbers with proper separators
    formatNumber(num) {
        if (num >= 1000000) {
            return (num / 1000000).toFixed(1) + 'M';
        } else if (num >= 1000) {
            return (num / 1000).toFixed(1) + 'K';
        }
        return num.toString();
    },

    // Format dates in a user-friendly way
    formatDate(date) {
        const now = new Date();
        const targetDate = new Date(date);
        const diffTime = Math.abs(now - targetDate);
        const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

        if (diffDays === 0) {
            return 'Hoje';
        } else if (diffDays === 1) {
            return 'Ontem';
        } else if (diffDays <= 7) {
            return `${diffDays} dias atrás`;
        } else {
            return targetDate.toLocaleDateString('pt-BR');
        }
    },

    // Format datetime with time
    formatDateTime(datetime) {
        return new Date(datetime).toLocaleString('pt-BR');
    },

    // Format phone numbers
    formatPhoneNumber(phone) {
        const cleaned = phone.replace(/\D/g, '');
        if (cleaned.length === 13) {
            // +55 11 99999-9999
            return `+${cleaned.slice(0, 2)} ${cleaned.slice(2, 4)} ${cleaned.slice(4, 9)}-${cleaned.slice(9)}`;
        } else if (cleaned.length === 11) {
            // 11 99999-9999
            return `${cleaned.slice(0, 2)} ${cleaned.slice(2, 7)}-${cleaned.slice(7)}`;
        }
        return phone;
    },

    // Get status badge class
    getStatusBadge(status) {
        const statusMap = {
            'sent': 'badge-success',
            'delivered': 'badge-success',
            'read': 'badge-primary',
            'failed': 'badge-error',
            'queued': 'badge-warning',
            'sending': 'badge-warning',
            'pending': 'badge-warning',
            'approved': 'badge-success',
            'rejected': 'badge-error',
            'active': 'badge-success',
            'paused': 'badge-warning',
            'stopped': 'badge-error',
            'completed': 'badge-primary',
            'draft': 'badge-gray'
        };
        return statusMap[status] || 'badge-gray';
    },

    // Get status text in Portuguese
    getStatusText(status) {
        const statusMap = {
            'sent': 'Enviada',
            'delivered': 'Entregue',
            'read': 'Lida',
            'failed': 'Falhou',
            'queued': 'Na fila',
            'sending': 'Enviando',
            'pending': 'Pendente',
            'approved': 'Aprovado',
            'rejected': 'Rejeitado',
            'active': 'Ativo',
            'paused': 'Pausado',
            'stopped': 'Parado',
            'completed': 'Concluído',
            'draft': 'Rascunho'
        };
        return statusMap[status] || status;
    },

    // Get message type icon
    getMessageTypeIcon(type) {
        const typeMap = {
            'text': 'fas fa-comment',
            'image': 'fas fa-image',
            'video': 'fas fa-video',
            'audio': 'fas fa-microphone',
            'document': 'fas fa-file',
            'location': 'fas fa-map-marker-alt',
            'contact': 'fas fa-address-book',
            'template': 'fas fa-file-alt'
        };
        return typeMap[type] || 'fas fa-comment';
    },

    // Debounce function for search inputs
    debounce(func, wait) {
        let timeout;
        return function executedFunction(...args) {
            const later = () => {
                clearTimeout(timeout);
                func(...args);
            };
            clearTimeout(timeout);
            timeout = setTimeout(later, wait);
        };
    },

    // Show toast notification
    showToast(message, type = 'success') {
        const toast = document.createElement('div');
        toast.className = `toast toast-${type}`;
        
        const icon = type === 'success' ? 'fa-check-circle' : 
                    type === 'error' ? 'fa-exclamation-circle' : 
                    type === 'warning' ? 'fa-exclamation-triangle' : 
                    'fa-info-circle';
        
        toast.innerHTML = `
            <i class="fas ${icon}"></i>
            <span>${message}</span>
        `;
        
        document.body.appendChild(toast);
        
        setTimeout(() => {
            toast.style.opacity = '0';
            toast.style.transform = 'translateX(100%)';
            setTimeout(() => {
                document.body.removeChild(toast);
            }, 300);
        }, 3000);
    },

    // Show loading spinner
    showLoading(container, message = 'Carregando...') {
        if (!container) return;
        
        container.innerHTML = `
            <div class="flex flex-col items-center justify-center py-12">
                <div class="spinner mb-4"></div>
                <p class="text-gray-600">${message}</p>
            </div>
        `;
    },

    // Show error state
    showError(container, message = 'Erro ao carregar dados', retryCallback = null) {
        if (!container) return;
        
        const retryButton = retryCallback ? `
            <button class="btn btn-primary btn-sm mt-4" onclick="(${retryCallback.toString()})()">
                <i class="fas fa-redo mr-2"></i>
                Tentar novamente
            </button>
        ` : '';
        
        container.innerHTML = `
            <div class="empty-state">
                <i class="fas fa-exclamation-triangle empty-state-icon text-error-500"></i>
                <h3 class="empty-state-title">Erro</h3>
                <p class="empty-state-description">${message}</p>
                ${retryButton}
            </div>
        `;
    },

    // Show empty state
    showEmpty(container, title = 'Nenhum item encontrado', description = 'Não há dados para exibir.', actionButton = null) {
        if (!container) return;
        
        const button = actionButton ? `
            <button class="btn btn-primary" onclick="${actionButton.callback}">
                ${actionButton.icon ? `<i class="${actionButton.icon} mr-2"></i>` : ''}
                ${actionButton.text}
            </button>
        ` : '';
        
        container.innerHTML = `
            <div class="empty-state">
                <i class="fas fa-inbox empty-state-icon"></i>
                <h3 class="empty-state-title">${title}</h3>
                <p class="empty-state-description">${description}</p>
                ${button}
            </div>
        `;
    },

    // Validate email
    validateEmail(email) {
        const re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        return re.test(email);
    },

    // Validate phone number
    validatePhone(phone) {
        const cleaned = phone.replace(/\D/g, '');
        return cleaned.length >= 10 && cleaned.length <= 15;
    },

    // Generate avatar from name
    generateAvatar(name) {
        const initials = name.split(' ')
            .map(word => word.charAt(0).toUpperCase())
            .slice(0, 2)
            .join('');
        
        const colors = [
            'bg-primary-500',
            'bg-success-500',
            'bg-warning-500',
            'bg-error-500',
            'var(--primary-600)',
            'var(--success-600)'
        ];
        
        const color = colors[name.length % colors.length];
        
        return {
            initials,
            color
        };
    },

    // Copy text to clipboard
    async copyToClipboard(text) {
        try {
            await navigator.clipboard.writeText(text);
            this.showToast('Copiado para área de transferência!', 'success');
        } catch (err) {
            console.error('Erro ao copiar:', err);
            this.showToast('Erro ao copiar texto', 'error');
        }
    },

    // Format file size
    formatFileSize(bytes) {
        if (bytes === 0) return '0 Bytes';
        const k = 1024;
        const sizes = ['Bytes', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    },

    // Calculate percentage
    calculatePercentage(part, total) {
        if (total === 0) return 0;
        return Math.round((part / total) * 100);
    },

    // Truncate text
    truncate(text, length = 50) {
        if (text.length <= length) return text;
        return text.substr(0, length) + '...';
    },

    // Get relative time
    getRelativeTime(date) {
        const now = new Date();
        const targetDate = new Date(date);
        const diffTime = now - targetDate;
        const diffMinutes = Math.floor(diffTime / (1000 * 60));
        const diffHours = Math.floor(diffTime / (1000 * 60 * 60));
        const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));

        if (diffMinutes < 1) return 'Agora mesmo';
        if (diffMinutes < 60) return `${diffMinutes}m atrás`;
        if (diffHours < 24) return `${diffHours}h atrás`;
        if (diffDays < 7) return `${diffDays}d atrás`;
        return this.formatDate(date);
    },

    // Parse URL parameters
    getURLParams() {
        const params = new URLSearchParams(window.location.search);
        const result = {};
        for (let [key, value] of params) {
            result[key] = value;
        }
        return result;
    },

    // Update URL without refresh
    updateURL(params) {
        const url = new URL(window.location);
        Object.keys(params).forEach(key => {
            if (params[key]) {
                url.searchParams.set(key, params[key]);
            } else {
                url.searchParams.delete(key);
            }
        });
        window.history.pushState({}, '', url);
    },

    // Local storage helpers
    storage: {
        set(key, value) {
            try {
                localStorage.setItem(key, JSON.stringify(value));
            } catch (e) {
                console.error('Error saving to localStorage:', e);
            }
        },
        
        get(key, defaultValue = null) {
            try {
                const item = localStorage.getItem(key);
                return item ? JSON.parse(item) : defaultValue;
            } catch (e) {
                console.error('Error reading from localStorage:', e);
                return defaultValue;
            }
        },
        
        remove(key) {
            try {
                localStorage.removeItem(key);
            } catch (e) {
                console.error('Error removing from localStorage:', e);
            }
        }
    }
};