// Header component with page title and actions
const { useState, useEffect } = React;

const Header = ({ onToggleSidebar, currentPage }) => {
    const [searchQuery, setSearchQuery] = useState('');
    const [notifications, setNotifications] = useState([]);
    const [showNotifications, setShowNotifications] = useState(false);

    const pageMap = {
        'dashboard': 'Dashboard',
        'messages': 'Mensagens',
        'contacts': 'Contatos',
        'templates': 'Templates',
        'campaigns': 'Campanhas',
        'segments': 'Segmentos',
        'webhooks': 'Webhooks',
        'analytics': 'Analytics',
        'settings': 'Configurações'
    };

    const handleSearch = (e) => {
        e.preventDefault();
        if (searchQuery.trim()) {
            utils.showToast(`Busca por: ${searchQuery}`, 'info');
        }
    };

    return React.createElement('div', { className: 'header' },
        React.createElement('div', { className: 'flex items-center gap-4' },
            // Mobile sidebar toggle
            React.createElement('button', {
                className: 'sidebar-toggle',
                onClick: onToggleSidebar
            },
                React.createElement('i', { className: 'fas fa-bars' })
            ),
            
            // Page title
            React.createElement('h1', { className: 'header-title' },
                pageMap[currentPage] || 'Dashboard'
            )
        ),

        React.createElement('div', { className: 'header-actions' },
            // Search
            React.createElement('div', { className: 'header-search' },
                React.createElement('form', { onSubmit: handleSearch },
                    React.createElement('input', {
                        type: 'text',
                        placeholder: 'Buscar...',
                        value: searchQuery,
                        onChange: (e) => setSearchQuery(e.target.value)
                    }),
                    React.createElement('i', { className: 'fas fa-search' })
                )
            ),

            // Notifications
            React.createElement('div', { className: 'header-notifications dropdown' },
                React.createElement('button', {
                    className: 'relative p-2 text-gray-600 hover:text-gray-900 transition-colors',
                    onClick: () => setShowNotifications(!showNotifications)
                },
                    React.createElement('i', { className: 'fas fa-bell' }),
                    React.createElement('span', { 
                        className: 'notification-badge' 
                    }, notifications.length || '3')
                ),

                // Notifications dropdown
                showNotifications && React.createElement('div', {
                    className: 'dropdown-menu show',
                    style: { minWidth: '300px' }
                },
                    React.createElement('div', {
                        className: 'px-4 py-3 border-b border-gray-200'
                    },
                        React.createElement('h3', { className: 'font-semibold' }, 'Notificações')
                    ),
                    React.createElement('div', { className: 'max-h-80 overflow-y-auto' },
                        React.createElement('div', { 
                            className: 'p-4 text-sm text-gray-600 border-b border-gray-100 hover:bg-gray-50' 
                        },
                            React.createElement('div', { className: 'font-medium mb-1' }, 'Sistema funcionando'),
                            React.createElement('div', { className: 'text-xs text-gray-500' }, 'Há 2 minutos')
                        ),
                        React.createElement('div', { 
                            className: 'p-4 text-sm text-gray-600 border-b border-gray-100 hover:bg-gray-50' 
                        },
                            React.createElement('div', { className: 'font-medium mb-1' }, 'Nova mensagem processada'),
                            React.createElement('div', { className: 'text-xs text-gray-500' }, 'Há 5 minutos')
                        ),
                        React.createElement('div', { 
                            className: 'p-4 text-sm text-gray-600 hover:bg-gray-50' 
                        },
                            React.createElement('div', { className: 'font-medium mb-1' }, 'Template aprovado'),
                            React.createElement('div', { className: 'text-xs text-gray-500' }, 'Há 10 minutos')
                        )
                    ),
                    React.createElement('div', {
                        className: 'p-3 border-t border-gray-200 text-center'
                    },
                        React.createElement('a', {
                            href: '#',
                            className: 'text-sm text-primary-600 hover:text-primary-700',
                            onClick: (e) => {
                                e.preventDefault();
                                setShowNotifications(false);
                            }
                        }, 'Ver todas')
                    )
                )
            ),

            // User menu
            React.createElement('div', { className: 'dropdown' },
                React.createElement('button', {
                    className: 'flex items-center gap-2 p-2 rounded-lg hover:bg-gray-100 transition-colors'
                },
                    React.createElement('div', {
                        className: 'avatar avatar-sm bg-primary-500'
                    }, 'A'),
                    React.createElement('i', { className: 'fas fa-chevron-down text-xs' })
                )
            )
        )
    );
};