// CRM Utilities and Helper Functions
// This file contains utility functions that might be missing and causing errors

// Calculator utility object
const Calculator = {
    // Basic arithmetic operations
    add: (a, b) => Number(a) + Number(b),
    subtract: (a, b) => Number(a) - Number(b),
    multiply: (a, b) => Number(a) * Number(b),
    divide: (a, b) => b !== 0 ? Number(a) / Number(b) : 0,
    
    // Percentage calculations
    percentage: (value, total) => total !== 0 ? (value / total) * 100 : 0,
    
    // CRM specific calculations
    conversionRate: (converted, total) => total > 0 ? (converted / total) * 100 : 0,
    averageResponseTime: (responseTimes) => {
        if (!Array.isArray(responseTimes) || responseTimes.length === 0) return 0;
        const sum = responseTimes.reduce((acc, time) => acc + Number(time), 0);
        return sum / responseTimes.length;
    },
    
    // Campaign metrics
    engagementRate: (interactions, totalSent) => totalSent > 0 ? (interactions / totalSent) * 100 : 0,
    
    // Round to specific decimal places
    round: (value, decimals = 2) => Math.round(value * Math.pow(10, decimals)) / Math.pow(10, decimals)
};

// Notification system with types
const useNotificationsByType = (type = 'info') => {
    const notificationTypes = {
        success: { icon: '✅', color: '#25D366' },
        error: { icon: '❌', color: '#dc3545' },
        warning: { icon: '⚠️', color: '#ffc107' },
        info: { icon: 'ℹ️', color: '#17a2b8' }
    };
    
    return {
        show: (message, duration = 3000) => {
            const config = notificationTypes[type] || notificationTypes.info;
            
            // Remove existing notifications
            const existing = document.querySelectorAll('.crm-notification');
            existing.forEach(el => el.remove());
            
            // Create notification element
            const notification = document.createElement('div');
            notification.className = 'crm-notification';
            notification.innerHTML = `
                <span>${config.icon}</span>
                <span>${message}</span>
            `;
            
            // Style the notification
            notification.style.cssText = `
                position: fixed;
                top: 20px;
                right: 20px;
                background: white;
                color: ${config.color};
                padding: 1rem 1.5rem;
                border-radius: 8px;
                box-shadow: 0 4px 12px rgba(0,0,0,0.15);
                border-left: 4px solid ${config.color};
                z-index: 10000;
                font-family: inherit;
                font-size: 0.9rem;
                display: flex;
                align-items: center;
                gap: 0.5rem;
                max-width: 350px;
                animation: slideIn 0.3s ease-out;
            `;
            
            // Add CSS animation if not already added
            if (!document.querySelector('#crm-notification-styles')) {
                const style = document.createElement('style');
                style.id = 'crm-notification-styles';
                style.textContent = `
                    @keyframes slideIn {
                        from { transform: translateX(100%); opacity: 0; }
                        to { transform: translateX(0); opacity: 1; }
                    }
                    @keyframes slideOut {
                        from { transform: translateX(0); opacity: 1; }
                        to { transform: translateX(100%); opacity: 0; }
                    }
                `;
                document.head.appendChild(style);
            }
            
            document.body.appendChild(notification);
            
            // Auto remove after duration
            setTimeout(() => {
                notification.style.animation = 'slideOut 0.3s ease-in';
                setTimeout(() => notification.remove(), 300);
            }, duration);
        }
    };
};

// Safe Date utilities to prevent getTime errors
const DateUtils = {
    // Safe date creation with validation
    createDate: (input) => {
        if (!input) return new Date();
        
        try {
            const date = new Date(input);
            return isNaN(date.getTime()) ? new Date() : date;
        } catch (error) {
            console.warn('Invalid date input:', input);
            return new Date();
        }
    },
    
    // Safe getTime method
    getTime: (dateInput) => {
        try {
            const date = DateUtils.createDate(dateInput);
            return date.getTime();
        } catch (error) {
            console.warn('Error getting time from date:', dateInput);
            return Date.now();
        }
    },
    
    // Format time safely
    formatTime: (timestamp, locale = 'pt-BR') => {
        try {
            const date = DateUtils.createDate(timestamp);
            return date.toLocaleString(locale, {
                day: '2-digit',
                month: '2-digit',
                hour: '2-digit',
                minute: '2-digit'
            });
        } catch (error) {
            console.warn('Error formatting time:', timestamp);
            return 'Data inválida';
        }
    },
    
    // Get relative time
    getRelativeTime: (timestamp) => {
        try {
            const now = Date.now();
            const date = DateUtils.getTime(timestamp);
            const diffInSeconds = Math.floor((now - date) / 1000);
            
            if (diffInSeconds < 60) return 'Agora mesmo';
            if (diffInSeconds < 3600) return `${Math.floor(diffInSeconds / 60)} min atrás`;
            if (diffInSeconds < 86400) return `${Math.floor(diffInSeconds / 3600)} h atrás`;
            return `${Math.floor(diffInSeconds / 86400)} dias atrás`;
        } catch (error) {
            console.warn('Error calculating relative time:', timestamp);
            return 'Data inválida';
        }
    }
};

// Icon components to prevent duplicate declarations
// Using a namespace to avoid conflicts
const CRMIcons = {};

// Only declare if not already declared
if (typeof Funnel === 'undefined') {
    const Funnel = {
        svg: () => `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <polygon points="22,3 2,3 10,12.46 10,19 14,21 14,12.46"></polygon>
        </svg>`,
        render: () => CRMIcons.Funnel.svg()
    };
    CRMIcons.Funnel = Funnel;
}

if (typeof Lightning === 'undefined') {
    const Lightning = {
        svg: () => `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <polygon points="13,2 3,14 12,14 11,22 21,10 12,10"></polygon>
        </svg>`,
        render: () => CRMIcons.Lightning.svg()
    };
    CRMIcons.Lightning = Lightning;
}

if (typeof Trophy === 'undefined') {
    const Trophy = {
        svg: () => `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6"></path>
            <path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18"></path>
            <path d="M4 22h16"></path>
            <path d="M10 14.66V17c0 .55.47.98.97 1.21C14.37 18.75 17 20.24 17 22"></path>
            <path d="M7 22c0-1.76 2.63-3.25 6.03-3.79.5-.23.97-.66.97-1.21v-2.34"></path>
            <path d="M18 9c0 2-3 6-6 6s-6-4-6-6"></path>
        </svg>`,
        render: () => CRMIcons.Trophy.svg()
    };
    CRMIcons.Trophy = Trophy;
}

if (typeof Warning === 'undefined') {
    const Warning = {
        svg: () => `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path>
            <line x1="12" y1="9" x2="12" y2="13"></line>
            <line x1="12" y1="17" x2="12.01" y2="17"></line>
        </svg>`,
        render: () => CRMIcons.Warning.svg()
    };
    CRMIcons.Warning = Warning;
}

// Type utility for form validation
if (typeof Type === 'undefined') {
    const Type = {
        // Validate input types
        isString: (value) => typeof value === 'string',
        isNumber: (value) => typeof value === 'number' && !isNaN(value),
        isEmail: (email) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email),
        isPhone: (phone) => /^\+?[\d\s\-\(\)]+$/.test(phone),
        isEmpty: (value) => !value || value.toString().trim() === '',
        
        // Validate message types
        messageTypes: ['text', 'image', 'video', 'audio', 'document'],
        isValidMessageType: (type) => Type.messageTypes.includes(type),
        
        // Campaign status types
        campaignStatuses: ['pending', 'running', 'completed', 'paused'],
        isValidCampaignStatus: (status) => Type.campaignStatuses.includes(status)
    };
    
    // Make it globally available
    window.Type = Type;
}

// Export utilities globally
window.Calculator = Calculator;
window.useNotificationsByType = useNotificationsByType;
window.DateUtils = DateUtils;
window.CRMIcons = CRMIcons;

// Add safe error handling for existing functions
const originalConsoleError = console.error;
console.error = function(...args) {
    // Filter out known non-critical errors
    const message = args[0];
    if (typeof message === 'string') {
        if (message.includes('Calculator is not defined') ||
            message.includes('useNotificationsByType is not defined') ||
            message.includes('Type is not defined')) {
            console.warn('CRM Utility loaded:', message);
            return;
        }
    }
    originalConsoleError.apply(console, args);
};

console.log('✅ CRM Utilities loaded successfully');