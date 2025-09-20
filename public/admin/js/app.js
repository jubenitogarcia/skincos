// Main React application for the Enterprise WhatsApp API Admin Interface
const { useState, useEffect } = React;

const App = () => {
    const [currentPage, setCurrentPage] = useState('dashboard');
    const [isLoading, setIsLoading] = useState(true);
    const [systemHealth, setSystemHealth] = useState(null);

    // Initialize the application
    useEffect(() => {
        const initializeApp = async () => {
            try {
                // Check system health on startup
                const health = await API.getHealth();
                setSystemHealth(health);
            } catch (error) {
                console.error('Failed to initialize app:', error);
                utils.showToast('Sistema iniciado com limitações', 'warning');
            } finally {
                setIsLoading(false);
            }
        };

        initializeApp();
        
        // Store app reference globally for navigation helpers
        window.currentApp = { changePage: setCurrentPage };
    }, []);

    // Handle page changes
    const handlePageChange = (page) => {
        setCurrentPage(page);
        utils.updateURL({ page });
        
        // Scroll to top on page change
        window.scrollTo(0, 0);
    };

    // Render the appropriate component based on current page
    const renderCurrentPage = () => {
        switch (currentPage) {
            case 'dashboard':
                return React.createElement(Dashboard);
            case 'messages':
                return React.createElement(Messages);
            case 'contacts':
                return React.createElement(Contacts);
            case 'templates':
                return React.createElement(Templates);
            case 'campaigns':
                return React.createElement(Campaigns);
            case 'segments':
                return React.createElement(Segments);
            case 'instagram':
                return React.createElement(Instagram);
            case 'webhooks':
                return React.createElement(PlaceholderPage, {
                    title: 'Webhooks',
                    description: 'Gerenciamento de webhooks em desenvolvimento',
                    icon: 'fas fa-link'
                });
            case 'analytics':
                return React.createElement(PlaceholderPage, {
                    title: 'Analytics',
                    description: 'Dashboard de analytics em desenvolvimento',
                    icon: 'fas fa-chart-line'
                });
            case 'settings':
                return React.createElement(PlaceholderPage, {
                    title: 'Configurações',
                    description: 'Configurações do sistema em desenvolvimento',
                    icon: 'fas fa-cog'
                });
            default:
                return React.createElement(Dashboard);
        }
    };

    // Show loading screen while initializing
    if (isLoading) {
        return React.createElement('div', { className: 'min-h-screen flex items-center justify-center bg-gray-50' },
            React.createElement('div', { className: 'text-center' },
                React.createElement('div', { className: 'spinner mb-4', style: { width: '40px', height: '40px' } }),
                React.createElement('h2', { className: 'text-xl font-semibold text-gray-900 mb-2' }, 
                    'Enterprise WhatsApp API'
                ),
                React.createElement('p', { className: 'text-gray-600' }, 'Carregando sistema...')
            )
        );
    }

    return React.createElement(Layout, {
        currentPage,
        onPageChange: handlePageChange
    },
        renderCurrentPage()
    );
};

// Placeholder component for pages in development
const PlaceholderPage = ({ title, description, icon }) => {
    return React.createElement('div', null,
        React.createElement('div', { className: 'page-header' },
            React.createElement('h2', { className: 'page-title' }, title),
            React.createElement('p', { className: 'page-subtitle' }, description)
        ),
        React.createElement('div', { className: 'empty-state' },
            React.createElement('i', { className: `${icon} empty-state-icon text-6xl` }),
            React.createElement('h3', { className: 'empty-state-title' }, `${title} em Desenvolvimento`),
            React.createElement('p', { className: 'empty-state-description' }, description),
            React.createElement('div', { className: 'mt-6' },
                React.createElement('button', {
                    className: 'btn btn-primary mr-3',
                    onClick: () => window.currentApp?.changePage('dashboard')
                }, 'Voltar ao Dashboard'),
                React.createElement('button', {
                    className: 'btn btn-secondary',
                    onClick: () => utils.showToast('Funcionalidade será implementada em breve', 'info')
                }, 'Notificar quando pronto')
            )
        )
    );
};

// Initialize the application when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    console.log('🚀 Initializing Enterprise WhatsApp API Admin Interface...');
    
    // Check if React is available
    if (typeof React === 'undefined') {
        console.error('React is not loaded. Please check the CDN links.');
        document.body.innerHTML = `
            <div style="display: flex; justify-content: center; align-items: center; height: 100vh; text-align: center; font-family: system-ui;">
                <div>
                    <h1 style="color: #dc2626; margin-bottom: 16px;">Erro de Carregamento</h1>
                    <p>React não foi carregado corretamente. Verifique sua conexão com a internet.</p>
                    <button onclick="window.location.reload()" style="margin-top: 16px; padding: 8px 16px; background: #0ea5e9; color: white; border: none; border-radius: 4px; cursor: pointer;">
                        Tentar Novamente
                    </button>
                </div>
            </div>
        `;
        return;
    }

    // Wait for all scripts to load before checking modules
    setTimeout(() => {
        initializeApplication();
    }, 1000);
});

function initializeApplication() {
    // Check if all required APIs are available
    if (typeof API === 'undefined' || typeof utils === 'undefined') {
        console.error('Required modules (API, utils) are not loaded.');
        
        // Show loading message and retry
        document.getElementById('root').innerHTML = `
            <div style="display: flex; justify-content: center; align-items: center; height: 100vh; text-align: center; font-family: Inter, sans-serif;">
                <div>
                    <div style="font-size: 48px; margin-bottom: 16px;">⏳</div>
                    <h2 style="color: #4f46e5; margin-bottom: 8px;">Carregando Sistema...</h2>
                    <p style="color: #6b7280;">Aguarde enquanto os módulos são inicializados.</p>
                </div>
            </div>
        `;
        
        // Retry after delay
        setTimeout(initializeApplication, 2000);
        return;
    }

    // Get URL parameters to initialize the correct page
    const urlParams = utils.getURLParams();
    const initialPage = urlParams.page || 'dashboard';

    // Render the application
    const root = ReactDOM.createRoot(document.getElementById('root'));
    
    // Set initial page if provided in URL
    if (initialPage !== 'dashboard') {
        setTimeout(() => {
            if (window.currentApp) {
                window.currentApp.changePage(initialPage);
            }
        }, 100);
    }
    
    root.render(React.createElement(App));

    console.log('🚀 Enterprise WhatsApp API Admin Interface initialized');
    console.log('📱 Current page:', initialPage);
    console.log('🔧 Available modules:', { API, utils, React, ReactDOM });
}

// Global error handler for React errors
window.addEventListener('error', (event) => {
    console.error('Global error:', event.error);
    if (typeof utils !== 'undefined') {
        utils.showToast('Erro inesperado. Verifique o console para detalhes.', 'error');
    }
});

// Handle unhandled promise rejections
window.addEventListener('unhandledrejection', (event) => {
    console.error('Unhandled promise rejection:', event.reason);
    if (typeof utils !== 'undefined') {
        utils.showToast('Erro de comunicação com servidor', 'error');
    }
});

// Expose useful debugging functions in development
if (window.location.hostname === 'localhost' || window.location.hostname.includes('replit')) {
    window.debugAdmin = {
        changePage: (page) => window.currentApp?.changePage(page),
        testAPI: () => API.getHealth(),
        showToast: (message, type) => utils.showToast(message, type),
        getSystemInfo: () => ({
            currentPage: window.currentApp?.currentPage,
            availableModules: { API, utils, React, ReactDOM },
            userAgent: navigator.userAgent,
            url: window.location.href
        })
    };
    console.log('🐛 Debug tools available at window.debugAdmin');
}