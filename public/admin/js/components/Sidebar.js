// Sidebar navigation component
const { useState, useEffect } = React;

const Sidebar = ({ isOpen, currentPage, onPageChange }) => {
    const navigationItems = [
        {
            section: 'Dashboard',
            items: [
                {
                    id: 'dashboard',
                    title: 'Visão Geral',
                    icon: 'fas fa-chart-pie',
                    page: 'dashboard'
                }
            ]
        },
        {
            section: 'Comunicação',
            items: [
                {
                    id: 'messages',
                    title: 'Mensagens',
                    icon: 'fas fa-comment-dots',
                    page: 'messages',
                    badge: 'Fase 2'
                },
                {
                    id: 'templates',
                    title: 'Templates',
                    icon: 'fas fa-file-alt',
                    page: 'templates',
                    badge: 'Fase 4'
                },
                {
                    id: 'campaigns',
                    title: 'Campanhas',
                    icon: 'fas fa-bullhorn',
                    page: 'campaigns',
                    badge: 'Fase 4'
                }
            ]
        },
        {
            section: 'CRM & Dados',
            items: [
                {
                    id: 'contacts',
                    title: 'Contatos',
                    icon: 'fas fa-address-book',
                    page: 'contacts',
                    badge: 'Fase 3'
                },
                {
                    id: 'segments',
                    title: 'Segmentos',
                    icon: 'fas fa-users',
                    page: 'segments',
                    badge: 'Fase 4'
                }
            ]
        },
        {
            section: 'Instagram OSINT',
            items: [
                {
                    id: 'instagram',
                    title: 'Instagram Module',
                    icon: 'fab fa-instagram',
                    page: 'instagram',
                    badge: 'NOVO'
                }
            ]
        },
        {
            section: 'Sistema',
            items: [
                {
                    id: 'webhooks',
                    title: 'Webhooks',
                    icon: 'fas fa-link',
                    page: 'webhooks'
                },
                {
                    id: 'analytics',
                    title: 'Analytics',
                    icon: 'fas fa-chart-line',
                    page: 'analytics'
                },
                {
                    id: 'settings',
                    title: 'Configurações',
                    icon: 'fas fa-cog',
                    page: 'settings'
                }
            ]
        }
    ];

    return React.createElement('div', {
        className: `sidebar ${isOpen ? 'open' : ''}`
    },
        // Sidebar Header
        React.createElement('div', { className: 'sidebar-header' },
            React.createElement('a', {
                href: '#',
                className: 'sidebar-logo',
                onClick: (e) => {
                    e.preventDefault();
                    onPageChange('dashboard');
                }
            },
                React.createElement('i', { className: 'fas fa-rocket text-primary-600' }),
                React.createElement('span', null, 'Enterprise API')
            )
        ),

        // Sidebar Navigation
        React.createElement('div', { className: 'sidebar-nav' },
            navigationItems.map(section =>
                React.createElement('div', { 
                    key: section.section, 
                    className: 'nav-section' 
                },
                    React.createElement('div', { 
                        className: 'nav-section-title' 
                    }, section.section),
                    section.items.map(item =>
                        React.createElement('a', {
                            key: item.id,
                            href: '#',
                            className: `nav-item ${currentPage === item.page ? 'active' : ''}`,
                            onClick: (e) => {
                                e.preventDefault();
                                onPageChange(item.page);
                            }
                        },
                            React.createElement('i', { className: item.icon }),
                            React.createElement('span', null, item.title),
                            item.badge && React.createElement('span', {
                                className: 'badge badge-primary ml-auto',
                                style: { fontSize: '10px' }
                            }, item.badge)
                        )
                    )
                )
            )
        ),

        // Sidebar Footer
        React.createElement('div', { 
            className: 'p-4 border-t border-gray-200 mt-auto' 
        },
            React.createElement('div', {
                className: 'flex items-center gap-3 text-sm text-gray-600'
            },
                React.createElement('div', {
                    className: 'avatar avatar-sm bg-primary-500'
                }, 'A'),
                React.createElement('div', null,
                    React.createElement('div', { className: 'font-medium' }, 'Admin'),
                    React.createElement('div', { className: 'text-xs' }, 'Sistema Enterprise')
                )
            )
        )
    );
};