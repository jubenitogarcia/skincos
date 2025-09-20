// Main Dashboard component with system overview and metrics
const { useState, useEffect } = React;

const Dashboard = () => {
    const [dashboardData, setDashboardData] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [refreshInterval, setRefreshInterval] = useState(null);

    // Load dashboard data
    const loadDashboardData = async () => {
        try {
            setError(null);
            const data = await API.dashboard.getStats();
            setDashboardData(data);
        } catch (err) {
            console.error('Error loading dashboard:', err);
            setError(err.message);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        loadDashboardData();
        
        // Auto-refresh every 30 seconds
        const interval = setInterval(loadDashboardData, 30000);
        setRefreshInterval(interval);
        
        return () => {
            if (interval) clearInterval(interval);
        };
    }, []);

    // Show loading state
    if (loading) {
        return React.createElement('div', { className: 'flex items-center justify-center h-64' },
            React.createElement('div', { className: 'text-center' },
                React.createElement('div', { className: 'spinner mb-4' }),
                React.createElement('p', { className: 'text-gray-600' }, 'Carregando dashboard...')
            )
        );
    }

    // Show error state
    if (error) {
        return React.createElement('div', { className: 'empty-state' },
            React.createElement('i', { className: 'fas fa-exclamation-triangle empty-state-icon text-error-500' }),
            React.createElement('h3', { className: 'empty-state-title' }, 'Erro ao carregar dashboard'),
            React.createElement('p', { className: 'empty-state-description' }, error),
            React.createElement('button', {
                className: 'btn btn-primary',
                onClick: () => {
                    setLoading(true);
                    loadDashboardData();
                }
            }, 'Tentar novamente')
        );
    }

    const { health, queueStats, messageStats } = dashboardData || {};

    return React.createElement('div', null,
        // Page header
        React.createElement('div', { className: 'page-header' },
            React.createElement('h2', { className: 'page-title' }, 'Dashboard'),
            React.createElement('p', { className: 'page-subtitle' }, 
                'Visão geral do sistema Enterprise WhatsApp API'
            ),
            React.createElement('div', { className: 'page-actions' },
                React.createElement('button', {
                    className: 'btn btn-secondary btn-sm',
                    onClick: loadDashboardData
                },
                    React.createElement('i', { className: 'fas fa-sync-alt mr-2' }),
                    'Atualizar'
                ),
                React.createElement('button', {
                    className: 'btn btn-primary btn-sm'
                },
                    React.createElement('i', { className: 'fas fa-download mr-2' }),
                    'Exportar Relatório'
                )
            )
        ),

        // System health status
        health && React.createElement('div', { className: 'mb-6' },
            React.createElement('div', { 
                className: `card ${health.success ? 'border-success-200 bg-success-50' : 'border-error-200 bg-error-50'}` 
            },
                React.createElement('div', { className: 'card-body p-4' },
                    React.createElement('div', { className: 'flex items-center gap-3' },
                        React.createElement('i', { 
                            className: `fas ${health.success ? 'fa-check-circle text-success-600' : 'fa-exclamation-triangle text-error-600'} text-xl` 
                        }),
                        React.createElement('div', null,
                            React.createElement('h3', { 
                                className: `font-semibold ${health.success ? 'text-success-900' : 'text-error-900'}` 
                            }, health.success ? 'Sistema Operacional' : 'Sistema com Problemas'),
                            React.createElement('p', { 
                                className: `text-sm ${health.success ? 'text-success-700' : 'text-error-700'}` 
                            }, health.system || 'Enterprise WhatsApp API v1')
                        ),
                        React.createElement('div', { className: 'ml-auto' },
                            React.createElement('span', {
                                className: `badge ${health.success ? 'badge-success' : 'badge-error'}`
                            }, health.status || 'unknown')
                        )
                    )
                )
            )
        ),

        // Stats cards
        React.createElement('div', { className: 'stats-grid' },
            // WhatsApp client status
            React.createElement('div', { className: 'stats-card' },
                React.createElement('div', { className: 'stats-header' },
                    React.createElement('span', { className: 'stats-title' }, 'Status WhatsApp'),
                    React.createElement('div', { className: 'stats-icon success' },
                        React.createElement('i', { className: 'fas fa-whatsapp' })
                    )
                ),
                React.createElement('div', { className: 'stats-value' },
                    health?.components?.whatsapp_client?.ready ? 'Online' : 'Offline'
                ),
                React.createElement('div', {
                    className: `stats-change ${health?.components?.whatsapp_client?.ready ? 'positive' : 'negative'}`
                },
                    React.createElement('i', { 
                        className: `fas ${health?.components?.whatsapp_client?.ready ? 'fa-check' : 'fa-times'}` 
                    }),
                    health?.components?.whatsapp_client?.status || 'Desconhecido'
                )
            ),

            // Queue status
            React.createElement('div', { className: 'stats-card' },
                React.createElement('div', { className: 'stats-header' },
                    React.createElement('span', { className: 'stats-title' }, 'Fila de Mensagens'),
                    React.createElement('div', { className: 'stats-icon primary' },
                        React.createElement('i', { className: 'fas fa-clock' })
                    )
                ),
                React.createElement('div', { className: 'stats-value' },
                    queueStats?.queue_health?.memory_count || '0'
                ),
                React.createElement('div', { className: 'stats-change neutral' },
                    React.createElement('i', { className: 'fas fa-info-circle' }),
                    `Modo: ${queueStats?.queue_mode || 'memory'}`
                )
            ),

            // Messages total
            React.createElement('div', { className: 'stats-card' },
                React.createElement('div', { className: 'stats-header' },
                    React.createElement('span', { className: 'stats-title' }, 'Total de Mensagens'),
                    React.createElement('div', { className: 'stats-icon warning' },
                        React.createElement('i', { className: 'fas fa-comment-dots' })
                    )
                ),
                React.createElement('div', { className: 'stats-value' },
                    utils.formatNumber(messageStats?.total || 0)
                ),
                React.createElement('div', { className: 'stats-change positive' },
                    React.createElement('i', { className: 'fas fa-arrow-up' }),
                    'Crescimento constante'
                )
            ),

            // Database status
            React.createElement('div', { className: 'stats-card' },
                React.createElement('div', { className: 'stats-header' },
                    React.createElement('span', { className: 'stats-title' }, 'Base de Dados'),
                    React.createElement('div', { className: 'stats-icon success' },
                        React.createElement('i', { className: 'fas fa-database' })
                    )
                ),
                React.createElement('div', { className: 'stats-value' },
                    health?.components?.database?.connected ? 'Conectado' : 'Desconectado'
                ),
                React.createElement('div', {
                    className: `stats-change ${health?.components?.database?.connected ? 'positive' : 'negative'}`
                },
                    React.createElement('i', { 
                        className: `fas ${health?.components?.database?.connected ? 'fa-check' : 'fa-times'}` 
                    }),
                    'PostgreSQL'
                )
            )
        ),

        // Quick actions
        React.createElement('div', { className: 'quick-actions' },
            React.createElement('div', { 
                className: 'quick-action-card',
                onClick: () => window.currentApp?.changePage('messages')
            },
                React.createElement('div', { className: 'quick-action-icon' },
                    React.createElement('i', { className: 'fas fa-paper-plane' })
                ),
                React.createElement('h3', { className: 'quick-action-title' }, 'Enviar Mensagem'),
                React.createElement('p', { className: 'quick-action-description' }, 'Envie mensagens individuais ou em massa')
            ),

            React.createElement('div', { 
                className: 'quick-action-card',
                onClick: () => window.currentApp?.changePage('contacts')
            },
                React.createElement('div', { className: 'quick-action-icon' },
                    React.createElement('i', { className: 'fas fa-user-plus' })
                ),
                React.createElement('h3', { className: 'quick-action-title' }, 'Novo Contato'),
                React.createElement('p', { className: 'quick-action-description' }, 'Adicione novos contatos ao CRM')
            ),

            React.createElement('div', { 
                className: 'quick-action-card',
                onClick: () => window.currentApp?.changePage('templates')
            },
                React.createElement('div', { className: 'quick-action-icon' },
                    React.createElement('i', { className: 'fas fa-file-alt' })
                ),
                React.createElement('h3', { className: 'quick-action-title' }, 'Criar Template'),
                React.createElement('p', { className: 'quick-action-description' }, 'Crie templates para suas campanhas')
            ),

            React.createElement('div', { 
                className: 'quick-action-card',
                onClick: () => window.currentApp?.changePage('campaigns')
            },
                React.createElement('div', { className: 'quick-action-icon' },
                    React.createElement('i', { className: 'fas fa-bullhorn' })
                ),
                React.createElement('h3', { className: 'quick-action-title' }, 'Nova Campanha'),
                React.createElement('p', { className: 'quick-action-description' }, 'Lance campanhas segmentadas')
            )
        ),

        // Recent activity
        React.createElement('div', { className: 'data-table' },
            React.createElement('div', { className: 'table-header' },
                React.createElement('h3', { className: 'table-title' }, 'Atividade Recente'),
                React.createElement('div', { className: 'table-filters' },
                    React.createElement('button', {
                        className: 'btn btn-secondary btn-sm'
                    }, 'Ver todas')
                )
            ),
            React.createElement('div', { className: 'table-container' },
                React.createElement('table', { className: 'table' },
                    React.createElement('thead', null,
                        React.createElement('tr', null,
                            React.createElement('th', null, 'Ação'),
                            React.createElement('th', null, 'Detalhes'),
                            React.createElement('th', null, 'Status'),
                            React.createElement('th', null, 'Data')
                        )
                    ),
                    React.createElement('tbody', null,
                        // Placeholder rows
                        React.createElement('tr', null,
                            React.createElement('td', null,
                                React.createElement('div', { className: 'flex items-center gap-2' },
                                    React.createElement('i', { className: 'fas fa-paper-plane text-primary-600' }),
                                    'Mensagem enviada'
                                )
                            ),
                            React.createElement('td', null, 'Para: +55 11 99999-9999'),
                            React.createElement('td', null,
                                React.createElement('span', { className: 'badge badge-success' }, 'Entregue')
                            ),
                            React.createElement('td', null, 'Agora mesmo')
                        ),
                        React.createElement('tr', null,
                            React.createElement('td', null,
                                React.createElement('div', { className: 'flex items-center gap-2' },
                                    React.createElement('i', { className: 'fas fa-user-plus text-success-600' }),
                                    'Contato adicionado'
                                )
                            ),
                            React.createElement('td', null, 'João Silva - Lead qualificado'),
                            React.createElement('td', null,
                                React.createElement('span', { className: 'badge badge-primary' }, 'Ativo')
                            ),
                            React.createElement('td', null, '2 minutos atrás')
                        ),
                        React.createElement('tr', null,
                            React.createElement('td', null,
                                React.createElement('div', { className: 'flex items-center gap-2' },
                                    React.createElement('i', { className: 'fas fa-file-alt text-warning-600' }),
                                    'Template aprovado'
                                )
                            ),
                            React.createElement('td', null, 'Promoção Black Friday'),
                            React.createElement('td', null,
                                React.createElement('span', { className: 'badge badge-success' }, 'Aprovado')
                            ),
                            React.createElement('td', null, '5 minutos atrás')
                        )
                    )
                )
            )
        )
    );
};