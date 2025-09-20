// Instagram Module React Component
const { useState, useEffect } = React;

const Instagram = () => {
    const [moduleHealth, setModuleHealth] = useState(null);
    const [accounts, setAccounts] = useState([]);
    const [config, setConfig] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    
    // Form states
    const [showAddAccountModal, setShowAddAccountModal] = useState(false);
    const [showOsintModal, setShowOsintModal] = useState(false);
    const [showAutomationModal, setShowAutomationModal] = useState(false);
    
    const [accountForm, setAccountForm] = useState({
        username: '',
        password: '',
        account_id: ''
    });
    
    const [osintForm, setOsintForm] = useState({
        username: '',
        deep_analysis: true
    });
    
    const [automationForm, setAutomationForm] = useState({
        account_id: '',
        target_hashtags: ['photography'],
        max_likes: 10,
        max_follows: 5
    });

    const INSTAGRAM_API_BASE = 'http://localhost:3003';

    // Helper function for API calls
    const apiCall = async (endpoint, options = {}) => {
        const defaultOptions = {
            headers: {
                'Content-Type': 'application/json',
                'Authorization': 'Bearer development-token'
            }
        };

        const response = await fetch(`${INSTAGRAM_API_BASE}${endpoint}`, {
            ...defaultOptions,
            ...options
        });

        if (!response.ok) {
            throw new Error(`API Error: ${response.status}`);
        }

        return await response.json();
    };

    // Load initial data
    useEffect(() => {
        loadInitialData();
    }, []);

    const loadInitialData = async () => {
        try {
            setLoading(true);
            setError(null);

            // Load health, accounts, and config in parallel
            const [healthResponse, accountsResponse, configResponse] = await Promise.all([
                fetch(`${INSTAGRAM_API_BASE}/health`),
                apiCall('/api/accounts'),
                apiCall('/api/config')
            ]);

            if (healthResponse.ok) {
                const health = await healthResponse.json();
                setModuleHealth(health);
            }

            setAccounts(accountsResponse.accounts || []);
            setConfig(configResponse.config || {});

        } catch (err) {
            console.error('Failed to load Instagram module data:', err);
            setError('Falha ao carregar dados do módulo Instagram. Verifique se a API está rodando na porta 3003.');
        } finally {
            setLoading(false);
        }
    };

    const handleAddAccount = async (e) => {
        e.preventDefault();
        try {
            await apiCall('/api/accounts', {
                method: 'POST',
                body: JSON.stringify(accountForm)
            });

            // Reload accounts
            const accountsResponse = await apiCall('/api/accounts');
            setAccounts(accountsResponse.accounts || []);
            
            // Reset form and close modal
            setAccountForm({ username: '', password: '', account_id: '' });
            setShowAddAccountModal(false);
            
            showToast('Conta adicionada com sucesso!', 'success');
        } catch (err) {
            showToast('Erro ao adicionar conta: ' + err.message, 'error');
        }
    };

    const handleOsintInvestigation = async (e) => {
        e.preventDefault();
        try {
            const response = await apiCall('/api/osint/investigate', {
                method: 'POST',
                body: JSON.stringify(osintForm)
            });

            setOsintForm({ username: '', deep_analysis: true });
            setShowOsintModal(false);
            
            if (response.status === 'processing') {
                showToast('Investigação OSINT iniciada em background!', 'info');
            } else {
                showToast('Investigação OSINT concluída!', 'success');
            }
        } catch (err) {
            showToast('Erro na investigação OSINT: ' + err.message, 'error');
        }
    };

    const handleAutomation = async (e) => {
        e.preventDefault();
        try {
            const response = await apiCall('/api/automation', {
                method: 'POST',
                body: JSON.stringify(automationForm)
            });

            setAutomationForm({
                account_id: '',
                target_hashtags: ['photography'],
                max_likes: 10,
                max_follows: 5
            });
            setShowAutomationModal(false);
            
            showToast(`Automação executada! ${response.automation_stats.likes_performed} likes, ${response.automation_stats.follows_performed} follows`, 'success');
        } catch (err) {
            showToast('Erro na automação: ' + err.message, 'error');
        }
    };

    const showToast = (message, type) => {
        // Simple toast notification (you might want to implement a proper toast system)
        const toast = document.createElement('div');
        toast.className = `toast toast-${type}`;
        toast.textContent = message;
        toast.style.cssText = `
            position: fixed;
            top: 20px;
            right: 20px;
            padding: 12px 24px;
            border-radius: 8px;
            color: white;
            z-index: 9999;
            font-weight: 500;
            background: ${type === 'success' ? '#22c55e' : type === 'error' ? '#ef4444' : '#3b82f6'};
            box-shadow: 0 4px 12px rgba(0,0,0,0.15);
        `;
        
        document.body.appendChild(toast);
        setTimeout(() => document.body.removeChild(toast), 3000);
    };

    if (loading) {
        return React.createElement('div', { className: 'flex justify-center items-center h-64' },
            React.createElement('div', { className: 'text-gray-500' }, 'Carregando módulo Instagram...')
        );
    }

    if (error) {
        return React.createElement('div', { className: 'bg-red-50 border border-red-200 rounded-lg p-4' },
            React.createElement('div', { className: 'flex items-center gap-3' },
                React.createElement('i', { className: 'fas fa-exclamation-triangle text-red-500' }),
                React.createElement('div', null,
                    React.createElement('h3', { className: 'font-medium text-red-800' }, 'Erro no Módulo Instagram'),
                    React.createElement('p', { className: 'text-red-600 mt-1' }, error),
                    React.createElement('button', {
                        className: 'btn-primary mt-3',
                        onClick: loadInitialData
                    }, 'Tentar Novamente')
                )
            )
        );
    }

    return React.createElement('div', { className: 'space-y-6' },
        // Header
        React.createElement('div', { className: 'flex items-center justify-between' },
            React.createElement('div', null,
                React.createElement('h1', { className: 'text-2xl font-bold text-gray-900' }, 'Instagram Module'),
                React.createElement('p', { className: 'text-gray-600 mt-1' }, 'Automação e OSINT para Instagram')
            ),
            React.createElement('div', { className: 'flex gap-3' },
                React.createElement('button', {
                    className: 'btn-primary',
                    onClick: () => setShowAddAccountModal(true)
                }, 
                    React.createElement('i', { className: 'fas fa-user-plus mr-2' }),
                    'Adicionar Conta'
                ),
                React.createElement('button', {
                    className: 'btn-secondary',
                    onClick: loadInitialData
                }, 
                    React.createElement('i', { className: 'fas fa-sync-alt mr-2' }),
                    'Atualizar'
                )
            )
        ),

        // Status Cards
        React.createElement('div', { className: 'grid grid-cols-1 md:grid-cols-4 gap-4' },
            React.createElement('div', { className: 'card' },
                React.createElement('div', { className: 'card-body' },
                    React.createElement('div', { className: 'flex items-center justify-between' },
                        React.createElement('div', null,
                            React.createElement('p', { className: 'text-sm text-gray-600' }, 'Status do Sistema'),
                            React.createElement('p', { className: 'text-2xl font-bold' }, 
                                moduleHealth?.status === 'healthy' ? '✅ Online' : '❌ Offline'
                            )
                        ),
                        React.createElement('i', { className: 'fas fa-heartbeat text-3xl text-green-500' })
                    )
                )
            ),
            React.createElement('div', { className: 'card' },
                React.createElement('div', { className: 'card-body' },
                    React.createElement('div', { className: 'flex items-center justify-between' },
                        React.createElement('div', null,
                            React.createElement('p', { className: 'text-sm text-gray-600' }, 'Contas Configuradas'),
                            React.createElement('p', { className: 'text-2xl font-bold' }, accounts.length)
                        ),
                        React.createElement('i', { className: 'fab fa-instagram text-3xl text-pink-500' })
                    )
                )
            ),
            React.createElement('div', { className: 'card' },
                React.createElement('div', { className: 'card-body' },
                    React.createElement('div', { className: 'flex items-center justify-between' },
                        React.createElement('div', null,
                            React.createElement('p', { className: 'text-sm text-gray-600' }, 'Sessões Ativas'),
                            React.createElement('p', { className: 'text-2xl font-bold' }, moduleHealth?.active_sessions || 0)
                        ),
                        React.createElement('i', { className: 'fas fa-users text-3xl text-blue-500' })
                    )
                )
            ),
            React.createElement('div', { className: 'card' },
                React.createElement('div', { className: 'card-body' },
                    React.createElement('div', { className: 'flex items-center justify-between' },
                        React.createElement('div', null,
                            React.createElement('p', { className: 'text-sm text-gray-600' }, 'Modo'),
                            React.createElement('p', { className: 'text-lg font-bold' }, 
                                moduleHealth?.mode === 'simulation' ? '🔧 Simulação' : '🚀 Produção'
                            )
                        ),
                        React.createElement('i', { className: 'fas fa-cog text-3xl text-gray-500' })
                    )
                )
            )
        ),

        // Quick Actions
        React.createElement('div', { className: 'grid grid-cols-1 md:grid-cols-3 gap-4' },
            React.createElement('div', { className: 'card hover-card' },
                React.createElement('div', { className: 'card-body text-center' },
                    React.createElement('i', { className: 'fas fa-search text-4xl text-blue-500 mb-4' }),
                    React.createElement('h3', { className: 'font-bold text-lg mb-2' }, 'Investigação OSINT'),
                    React.createElement('p', { className: 'text-gray-600 mb-4' }, 'Colete informações detalhadas sobre perfis do Instagram'),
                    React.createElement('button', {
                        className: 'btn-primary w-full',
                        onClick: () => setShowOsintModal(true)
                    }, 'Iniciar Investigação')
                )
            ),
            React.createElement('div', { className: 'card hover-card' },
                React.createElement('div', { className: 'card-body text-center' },
                    React.createElement('i', { className: 'fas fa-robot text-4xl text-green-500 mb-4' }),
                    React.createElement('h3', { className: 'font-bold text-lg mb-2' }, 'Automação'),
                    React.createElement('p', { className: 'text-gray-600 mb-4' }, 'Execute ações automatizadas de engajamento'),
                    React.createElement('button', {
                        className: 'btn-primary w-full',
                        onClick: () => setShowAutomationModal(true)
                    }, 'Configurar Automação')
                )
            ),
            React.createElement('div', { className: 'card hover-card' },
                React.createElement('div', { className: 'card-body text-center' },
                    React.createElement('i', { className: 'fas fa-download text-4xl text-purple-500 mb-4' }),
                    React.createElement('h3', { className: 'font-bold text-lg mb-2' }, 'Download de Conteúdo'),
                    React.createElement('p', { className: 'text-gray-600 mb-4' }, 'Baixe posts, stories e highlights'),
                    React.createElement('button', {
                        className: 'btn-primary w-full',
                        onClick: () => showToast('Funcionalidade em desenvolvimento', 'info')
                    }, 'Download')
                )
            )
        ),

        // Accounts Table
        React.createElement('div', { className: 'card' },
            React.createElement('div', { className: 'card-header' },
                React.createElement('h2', { className: 'text-lg font-semibold' }, 'Contas Configuradas')
            ),
            React.createElement('div', { className: 'card-body' },
                accounts.length > 0 
                    ? React.createElement('div', { className: 'overflow-x-auto' },
                        React.createElement('table', { className: 'table' },
                            React.createElement('thead', null,
                                React.createElement('tr', null,
                                    React.createElement('th', null, 'Username'),
                                    React.createElement('th', null, 'ID da Conta'),
                                    React.createElement('th', null, 'Status'),
                                    React.createElement('th', null, 'Adicionado em'),
                                    React.createElement('th', null, 'Ações')
                                )
                            ),
                            React.createElement('tbody', null,
                                accounts.map(account =>
                                    React.createElement('tr', { key: account.account_id },
                                        React.createElement('td', { className: 'font-medium' }, account.username),
                                        React.createElement('td', null, account.account_id),
                                        React.createElement('td', null,
                                            React.createElement('span', {
                                                className: `badge ${account.is_active ? 'badge-success' : 'badge-secondary'}`
                                            }, account.is_active ? 'Ativo' : 'Inativo')
                                        ),
                                        React.createElement('td', null, new Date(account.added_at).toLocaleDateString('pt-BR')),
                                        React.createElement('td', null,
                                            React.createElement('button', {
                                                className: 'btn-sm btn-secondary mr-2',
                                                onClick: () => showToast('Analytics em desenvolvimento', 'info')
                                            }, 'Analytics'),
                                            React.createElement('button', {
                                                className: 'btn-sm btn-danger',
                                                onClick: () => showToast('Remoção em desenvolvimento', 'info')
                                            }, 'Remover')
                                        )
                                    )
                                )
                            )
                        )
                    )
                    : React.createElement('div', { className: 'text-center py-8 text-gray-500' },
                        React.createElement('i', { className: 'fab fa-instagram text-6xl mb-4 opacity-50' }),
                        React.createElement('p', null, 'Nenhuma conta configurada ainda'),
                        React.createElement('button', {
                            className: 'btn-primary mt-3',
                            onClick: () => setShowAddAccountModal(true)
                        }, 'Adicionar Primeira Conta')
                    )
            )
        ),

        // Modals
        showAddAccountModal && React.createElement('div', {
            className: 'modal-overlay',
            onClick: () => setShowAddAccountModal(false)
        },
            React.createElement('div', {
                className: 'modal-content',
                onClick: (e) => e.stopPropagation()
            },
                React.createElement('div', { className: 'modal-header' },
                    React.createElement('h3', null, 'Adicionar Conta Instagram'),
                    React.createElement('button', {
                        className: 'modal-close',
                        onClick: () => setShowAddAccountModal(false)
                    }, '×')
                ),
                React.createElement('form', { onSubmit: handleAddAccount },
                    React.createElement('div', { className: 'form-group' },
                        React.createElement('label', null, 'Username'),
                        React.createElement('input', {
                            type: 'text',
                            required: true,
                            value: accountForm.username,
                            onChange: (e) => setAccountForm({...accountForm, username: e.target.value})
                        })
                    ),
                    React.createElement('div', { className: 'form-group' },
                        React.createElement('label', null, 'Password'),
                        React.createElement('input', {
                            type: 'password',
                            required: true,
                            value: accountForm.password,
                            onChange: (e) => setAccountForm({...accountForm, password: e.target.value})
                        })
                    ),
                    React.createElement('div', { className: 'form-group' },
                        React.createElement('label', null, 'ID da Conta (opcional)'),
                        React.createElement('input', {
                            type: 'text',
                            value: accountForm.account_id,
                            onChange: (e) => setAccountForm({...accountForm, account_id: e.target.value})
                        })
                    ),
                    React.createElement('div', { className: 'modal-footer' },
                        React.createElement('button', {
                            type: 'button',
                            className: 'btn-secondary',
                            onClick: () => setShowAddAccountModal(false)
                        }, 'Cancelar'),
                        React.createElement('button', {
                            type: 'submit',
                            className: 'btn-primary'
                        }, 'Adicionar Conta')
                    )
                )
            )
        ),

        showOsintModal && React.createElement('div', {
            className: 'modal-overlay',
            onClick: () => setShowOsintModal(false)
        },
            React.createElement('div', {
                className: 'modal-content',
                onClick: (e) => e.stopPropagation()
            },
                React.createElement('div', { className: 'modal-header' },
                    React.createElement('h3', null, 'Investigação OSINT'),
                    React.createElement('button', {
                        className: 'modal-close',
                        onClick: () => setShowOsintModal(false)
                    }, '×')
                ),
                React.createElement('form', { onSubmit: handleOsintInvestigation },
                    React.createElement('div', { className: 'form-group' },
                        React.createElement('label', null, 'Username do Alvo'),
                        React.createElement('input', {
                            type: 'text',
                            required: true,
                            placeholder: 'ex: @usuario_target',
                            value: osintForm.username,
                            onChange: (e) => setOsintForm({...osintForm, username: e.target.value})
                        })
                    ),
                    React.createElement('div', { className: 'form-group' },
                        React.createElement('label', { className: 'flex items-center gap-2' },
                            React.createElement('input', {
                                type: 'checkbox',
                                checked: osintForm.deep_analysis,
                                onChange: (e) => setOsintForm({...osintForm, deep_analysis: e.target.checked})
                            }),
                            'Análise Profunda (background)'
                        )
                    ),
                    React.createElement('div', { className: 'modal-footer' },
                        React.createElement('button', {
                            type: 'button',
                            className: 'btn-secondary',
                            onClick: () => setShowOsintModal(false)
                        }, 'Cancelar'),
                        React.createElement('button', {
                            type: 'submit',
                            className: 'btn-primary'
                        }, 'Iniciar Investigação')
                    )
                )
            )
        ),

        showAutomationModal && React.createElement('div', {
            className: 'modal-overlay',
            onClick: () => setShowAutomationModal(false)
        },
            React.createElement('div', {
                className: 'modal-content',
                onClick: (e) => e.stopPropagation()
            },
                React.createElement('div', { className: 'modal-header' },
                    React.createElement('h3', null, 'Configurar Automação'),
                    React.createElement('button', {
                        className: 'modal-close',
                        onClick: () => setShowAutomationModal(false)
                    }, '×')
                ),
                React.createElement('form', { onSubmit: handleAutomation },
                    React.createElement('div', { className: 'form-group' },
                        React.createElement('label', null, 'Conta para Automação'),
                        React.createElement('select', {
                            required: true,
                            value: automationForm.account_id,
                            onChange: (e) => setAutomationForm({...automationForm, account_id: e.target.value})
                        },
                            React.createElement('option', { value: '' }, 'Selecione uma conta'),
                            accounts.map(account =>
                                React.createElement('option', {
                                    key: account.account_id,
                                    value: account.account_id
                                }, account.username)
                            )
                        )
                    ),
                    React.createElement('div', { className: 'form-group' },
                        React.createElement('label', null, 'Hashtags Alvo (separadas por vírgula)'),
                        React.createElement('input', {
                            type: 'text',
                            value: automationForm.target_hashtags.join(', '),
                            onChange: (e) => setAutomationForm({
                                ...automationForm,
                                target_hashtags: e.target.value.split(',').map(tag => tag.trim())
                            })
                        })
                    ),
                    React.createElement('div', { className: 'grid grid-cols-2 gap-4' },
                        React.createElement('div', { className: 'form-group' },
                            React.createElement('label', null, 'Máximo de Likes'),
                            React.createElement('input', {
                                type: 'number',
                                min: 1,
                                max: 100,
                                value: automationForm.max_likes,
                                onChange: (e) => setAutomationForm({...automationForm, max_likes: parseInt(e.target.value)})
                            })
                        ),
                        React.createElement('div', { className: 'form-group' },
                            React.createElement('label', null, 'Máximo de Follows'),
                            React.createElement('input', {
                                type: 'number',
                                min: 1,
                                max: 50,
                                value: automationForm.max_follows,
                                onChange: (e) => setAutomationForm({...automationForm, max_follows: parseInt(e.target.value)})
                            })
                        )
                    ),
                    React.createElement('div', { className: 'modal-footer' },
                        React.createElement('button', {
                            type: 'button',
                            className: 'btn-secondary',
                            onClick: () => setShowAutomationModal(false)
                        }, 'Cancelar'),
                        React.createElement('button', {
                            type: 'submit',
                            className: 'btn-primary'
                        }, 'Executar Automação')
                    )
                )
            )
        )
    );
};