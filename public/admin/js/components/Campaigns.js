// Campaigns component for Phase 4 implementation
const { useState, useEffect } = React;

const Campaigns = () => {
    const [campaigns, setCampaigns] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [filters, setFilters] = useState({
        status: '',
        template_id: ''
    });
    const [showCreateModal, setShowCreateModal] = useState(false);
    const [selectedCampaign, setSelectedCampaign] = useState(null);
    const [showDetailModal, setShowDetailModal] = useState(false);

    const loadCampaigns = async () => {
        try {
            setLoading(true);
            setError(null);
            const response = await API.campaigns.list(filters);
            setCampaigns(response.campaigns || []);
        } catch (err) {
            console.error('Error loading campaigns:', err);
            setError(err.message);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        loadCampaigns();
    }, [filters]);

    const handleFilterChange = (key, value) => {
        setFilters(prev => ({ ...prev, [key]: value }));
    };

    const handleCreateCampaign = async (campaignData) => {
        try {
            await API.campaigns.create(campaignData);
            utils.showToast('Campanha criada com sucesso!', 'success');
            setShowCreateModal(false);
            loadCampaigns();
        } catch (err) {
            utils.showToast(`Erro ao criar campanha: ${err.message}`, 'error');
        }
    };

    const handleCampaignAction = async (campaignId, action) => {
        try {
            switch (action) {
                case 'start':
                    await API.campaigns.start(campaignId);
                    utils.showToast('Campanha iniciada!', 'success');
                    break;
                case 'pause':
                    await API.campaigns.pause(campaignId);
                    utils.showToast('Campanha pausada!', 'success');
                    break;
                case 'resume':
                    await API.campaigns.resume(campaignId);
                    utils.showToast('Campanha retomada!', 'success');
                    break;
                case 'stop':
                    await API.campaigns.stop(campaignId);
                    utils.showToast('Campanha parada!', 'success');
                    break;
            }
            loadCampaigns();
        } catch (err) {
            utils.showToast(`Erro: ${err.message}`, 'error');
        }
    };

    const handleViewCampaign = async (campaign) => {
        try {
            const detailed = await API.campaigns.get(campaign.id);
            setSelectedCampaign(detailed);
            setShowDetailModal(true);
        } catch (err) {
            utils.showToast(`Erro ao carregar detalhes: ${err.message}`, 'error');
        }
    };

    if (loading && campaigns.length === 0) {
        return React.createElement('div', { className: 'flex items-center justify-center h-64' },
            React.createElement('div', { className: 'text-center' },
                React.createElement('div', { className: 'spinner mb-4' }),
                React.createElement('p', { className: 'text-gray-600' }, 'Carregando campanhas...')
            )
        );
    }

    return React.createElement('div', null,
        // Page header
        React.createElement('div', { className: 'page-header' },
            React.createElement('h2', { className: 'page-title' }, 'Campanhas'),
            React.createElement('p', { className: 'page-subtitle' }, 
                'Gerencie campanhas de marketing e comunicação'
            ),
            React.createElement('div', { className: 'page-actions' },
                React.createElement('button', {
                    className: 'btn btn-secondary btn-sm',
                    onClick: loadCampaigns
                },
                    React.createElement('i', { className: 'fas fa-sync-alt mr-2' }),
                    'Atualizar'
                ),
                React.createElement('button', {
                    className: 'btn btn-primary',
                    onClick: () => setShowCreateModal(true)
                },
                    React.createElement('i', { className: 'fas fa-plus mr-2' }),
                    'Nova Campanha'
                )
            )
        ),

        // Campaign stats cards
        React.createElement('div', { className: 'stats-grid mb-6' },
            React.createElement('div', { className: 'stats-card' },
                React.createElement('div', { className: 'stats-header' },
                    React.createElement('span', { className: 'stats-title' }, 'Campanhas Ativas'),
                    React.createElement('div', { className: 'stats-icon success' },
                        React.createElement('i', { className: 'fas fa-play' })
                    )
                ),
                React.createElement('div', { className: 'stats-value' },
                    campaigns.filter(c => c.status === 'active').length
                ),
                React.createElement('div', { className: 'stats-change positive' },
                    React.createElement('i', { className: 'fas fa-arrow-up' }),
                    'Em execução'
                )
            ),
            React.createElement('div', { className: 'stats-card' },
                React.createElement('div', { className: 'stats-header' },
                    React.createElement('span', { className: 'stats-title' }, 'Campanhas Pausadas'),
                    React.createElement('div', { className: 'stats-icon warning' },
                        React.createElement('i', { className: 'fas fa-pause' })
                    )
                ),
                React.createElement('div', { className: 'stats-value' },
                    campaigns.filter(c => c.status === 'paused').length
                ),
                React.createElement('div', { className: 'stats-change neutral' },
                    React.createElement('i', { className: 'fas fa-clock' }),
                    'Aguardando'
                )
            ),
            React.createElement('div', { className: 'stats-card' },
                React.createElement('div', { className: 'stats-header' },
                    React.createElement('span', { className: 'stats-title' }, 'Campanhas Concluídas'),
                    React.createElement('div', { className: 'stats-icon primary' },
                        React.createElement('i', { className: 'fas fa-check' })
                    )
                ),
                React.createElement('div', { className: 'stats-value' },
                    campaigns.filter(c => c.status === 'completed').length
                ),
                React.createElement('div', { className: 'stats-change positive' },
                    React.createElement('i', { className: 'fas fa-check' }),
                    'Finalizadas'
                )
            )
        ),

        // Filters
        React.createElement('div', { className: 'card mb-6' },
            React.createElement('div', { className: 'card-body' },
                React.createElement('div', { className: 'grid grid-cols-1 md:grid-cols-3 gap-4' },
                    React.createElement('div', null,
                        React.createElement('label', { className: 'input-label' }, 'Status'),
                        React.createElement('select', {
                            className: 'input select',
                            value: filters.status,
                            onChange: (e) => handleFilterChange('status', e.target.value)
                        },
                            React.createElement('option', { value: '' }, 'Todos'),
                            React.createElement('option', { value: 'draft' }, 'Rascunho'),
                            React.createElement('option', { value: 'active' }, 'Ativa'),
                            React.createElement('option', { value: 'paused' }, 'Pausada'),
                            React.createElement('option', { value: 'stopped' }, 'Parada'),
                            React.createElement('option', { value: 'completed' }, 'Concluída')
                        )
                    ),
                    React.createElement('div', null,
                        React.createElement('label', { className: 'input-label' }, 'Template'),
                        React.createElement('select', {
                            className: 'input select',
                            value: filters.template_id,
                            onChange: (e) => handleFilterChange('template_id', e.target.value)
                        },
                            React.createElement('option', { value: '' }, 'Todos os templates')
                        )
                    ),
                    React.createElement('div', { className: 'flex items-end' },
                        React.createElement('button', {
                            className: 'btn btn-secondary w-full',
                            onClick: () => setFilters({ status: '', template_id: '' })
                        }, 'Limpar Filtros')
                    )
                )
            )
        ),

        // Campaigns table
        React.createElement('div', { className: 'data-table' },
            React.createElement('div', { className: 'table-header' },
                React.createElement('h3', { className: 'table-title' }, 'Lista de Campanhas'),
                React.createElement('div', { className: 'table-filters' },
                    React.createElement('span', { className: 'text-sm text-gray-600' },
                        `${campaigns.length} campanhas`
                    )
                )
            ),
            error && React.createElement('div', { className: 'p-4 bg-error-50 border border-error-200 rounded-lg' },
                React.createElement('div', { className: 'flex items-center gap-2 text-error-700' },
                    React.createElement('i', { className: 'fas fa-exclamation-triangle' }),
                    React.createElement('span', null, error)
                )
            ),
            React.createElement('div', { className: 'table-container' },
                campaigns.length > 0 ? React.createElement('table', { className: 'table' },
                    React.createElement('thead', null,
                        React.createElement('tr', null,
                            React.createElement('th', null, 'Nome'),
                            React.createElement('th', null, 'Segmento'),
                            React.createElement('th', null, 'Template'),
                            React.createElement('th', null, 'Status'),
                            React.createElement('th', null, 'Progresso'),
                            React.createElement('th', null, 'Criada em'),
                            React.createElement('th', null, 'Ações')
                        )
                    ),
                    React.createElement('tbody', null,
                        campaigns.map(campaign =>
                            React.createElement('tr', { key: campaign.id },
                                React.createElement('td', null,
                                    React.createElement('div', null,
                                        React.createElement('div', { className: 'font-medium' },
                                            campaign.name || 'Campanha sem nome'
                                        ),
                                        campaign.description && React.createElement('div', { 
                                            className: 'text-sm text-gray-500' 
                                        }, utils.truncate(campaign.description, 50))
                                    )
                                ),
                                React.createElement('td', null,
                                    React.createElement('span', { className: 'badge badge-primary text-xs' },
                                        campaign.segment_name || 'Segmento não definido'
                                    )
                                ),
                                React.createElement('td', null,
                                    React.createElement('span', { className: 'badge badge-gray text-xs' },
                                        campaign.template_name || 'Template não definido'
                                    )
                                ),
                                React.createElement('td', null,
                                    React.createElement('span', { 
                                        className: `badge ${utils.getStatusBadge(campaign.status)}` 
                                    }, utils.getStatusText(campaign.status))
                                ),
                                React.createElement('td', null,
                                    React.createElement('div', { className: 'w-24' },
                                        React.createElement('div', { className: 'progress' },
                                            React.createElement('div', {
                                                className: 'progress-bar',
                                                style: { 
                                                    width: `${campaign.progress || 0}%` 
                                                }
                                            })
                                        ),
                                        React.createElement('div', { className: 'text-xs text-gray-500 mt-1' },
                                            `${campaign.sent || 0}/${campaign.total || 0}`
                                        )
                                    )
                                ),
                                React.createElement('td', null,
                                    React.createElement('div', { className: 'text-sm' },
                                        utils.getRelativeTime(campaign.created_at)
                                    )
                                ),
                                React.createElement('td', null,
                                    React.createElement('div', { className: 'action-buttons' },
                                        React.createElement('button', {
                                            className: 'action-btn view',
                                            title: 'Ver detalhes',
                                            onClick: () => handleViewCampaign(campaign)
                                        },
                                            React.createElement('i', { className: 'fas fa-eye' })
                                        ),
                                        campaign.status === 'draft' && React.createElement('button', {
                                            className: 'btn btn-success btn-sm',
                                            onClick: () => handleCampaignAction(campaign.id, 'start')
                                        },
                                            React.createElement('i', { className: 'fas fa-play mr-1' }),
                                            'Iniciar'
                                        ),
                                        campaign.status === 'active' && React.createElement('button', {
                                            className: 'btn btn-warning btn-sm',
                                            onClick: () => handleCampaignAction(campaign.id, 'pause')
                                        },
                                            React.createElement('i', { className: 'fas fa-pause mr-1' }),
                                            'Pausar'
                                        ),
                                        campaign.status === 'paused' && React.createElement('button', {
                                            className: 'btn btn-success btn-sm',
                                            onClick: () => handleCampaignAction(campaign.id, 'resume')
                                        },
                                            React.createElement('i', { className: 'fas fa-play mr-1' }),
                                            'Retomar'
                                        ),
                                        ['active', 'paused'].includes(campaign.status) && React.createElement('button', {
                                            className: 'btn btn-error btn-sm',
                                            onClick: () => {
                                                if (confirm('Tem certeza que deseja parar esta campanha?')) {
                                                    handleCampaignAction(campaign.id, 'stop');
                                                }
                                            }
                                        },
                                            React.createElement('i', { className: 'fas fa-stop mr-1' }),
                                            'Parar'
                                        )
                                    )
                                )
                            )
                        )
                    )
                ) : React.createElement('div', { className: 'empty-state' },
                    React.createElement('i', { className: 'fas fa-bullhorn empty-state-icon' }),
                    React.createElement('h3', { className: 'empty-state-title' }, 'Nenhuma campanha encontrada'),
                    React.createElement('p', { className: 'empty-state-description' }, 
                        'Crie sua primeira campanha para começar a alcançar seus clientes'
                    ),
                    React.createElement('button', {
                        className: 'btn btn-primary',
                        onClick: () => setShowCreateModal(true)
                    },
                        React.createElement('i', { className: 'fas fa-plus mr-2' }),
                        'Criar primeira campanha'
                    )
                )
            )
        ),

        // Create Campaign Modal
        showCreateModal && React.createElement(CreateCampaignModal, {
            onClose: () => setShowCreateModal(false),
            onCreate: handleCreateCampaign
        }),

        // Campaign Detail Modal
        showDetailModal && selectedCampaign && React.createElement(CampaignDetailModal, {
            campaign: selectedCampaign,
            onClose: () => {
                setShowDetailModal(false);
                setSelectedCampaign(null);
            },
            onAction: handleCampaignAction
        })
    );
};

// Create Campaign Modal Component
const CreateCampaignModal = ({ onClose, onCreate }) => {
    const [formData, setFormData] = useState({
        name: '',
        description: '',
        segment_id: '',
        template_id: '',
        scheduled_at: '',
        variables: {}
    });
    const [creating, setCreating] = useState(false);
    const [templates, setTemplates] = useState([]);
    const [segments, setSegments] = useState([]);

    useEffect(() => {
        // Load templates and segments
        const loadData = async () => {
            try {
                const [templatesRes, segmentsRes] = await Promise.all([
                    API.templates.list({ status: 'approved' }),
                    API.segments.list()
                ]);
                setTemplates(templatesRes.templates || []);
                setSegments(segmentsRes.segments || []);
            } catch (err) {
                console.error('Error loading templates/segments:', err);
            }
        };
        loadData();
    }, []);

    const handleSubmit = async (e) => {
        e.preventDefault();
        setCreating(true);
        try {
            await onCreate(formData);
        } finally {
            setCreating(false);
        }
    };

    const handleChange = (key, value) => {
        setFormData(prev => ({ ...prev, [key]: value }));
    };

    return React.createElement('div', { className: 'modal-overlay', onClick: onClose },
        React.createElement('div', { 
            className: 'modal', 
            onClick: (e) => e.stopPropagation(),
            style: { maxWidth: '600px' }
        },
            React.createElement('div', { className: 'modal-header' },
                React.createElement('h3', { className: 'text-lg font-semibold' }, 'Nova Campanha'),
                React.createElement('button', {
                    className: 'text-gray-500 hover:text-gray-700',
                    onClick: onClose
                },
                    React.createElement('i', { className: 'fas fa-times' })
                )
            ),
            React.createElement('form', { onSubmit: handleSubmit },
                React.createElement('div', { className: 'modal-body' },
                    React.createElement('div', { className: 'input-group' },
                        React.createElement('label', { className: 'input-label' }, 'Nome da Campanha *'),
                        React.createElement('input', {
                            type: 'text',
                            className: 'input',
                            placeholder: 'Ex: Promoção Black Friday 2024',
                            value: formData.name,
                            onChange: (e) => handleChange('name', e.target.value),
                            required: true
                        })
                    ),
                    React.createElement('div', { className: 'input-group' },
                        React.createElement('label', { className: 'input-label' }, 'Descrição'),
                        React.createElement('textarea', {
                            className: 'input textarea',
                            rows: 3,
                            placeholder: 'Descrição opcional da campanha...',
                            value: formData.description,
                            onChange: (e) => handleChange('description', e.target.value)
                        })
                    ),
                    React.createElement('div', { className: 'grid grid-cols-1 md:grid-cols-2 gap-4' },
                        React.createElement('div', { className: 'input-group' },
                            React.createElement('label', { className: 'input-label' }, 'Segmento *'),
                            React.createElement('select', {
                                className: 'input select',
                                value: formData.segment_id,
                                onChange: (e) => handleChange('segment_id', e.target.value),
                                required: true
                            },
                                React.createElement('option', { value: '' }, 'Selecione um segmento'),
                                segments.map(segment =>
                                    React.createElement('option', { 
                                        key: segment.id, 
                                        value: segment.id 
                                    }, 
                                        `${segment.name} (${segment.contact_count || 0} contatos)`
                                    )
                                )
                            ),
                            segments.length === 0 && React.createElement('p', { 
                                className: 'text-xs text-gray-500 mt-1' 
                            }, 'Nenhum segmento disponível. Crie um segmento primeiro.')
                        ),
                        React.createElement('div', { className: 'input-group' },
                            React.createElement('label', { className: 'input-label' }, 'Template *'),
                            React.createElement('select', {
                                className: 'input select',
                                value: formData.template_id,
                                onChange: (e) => handleChange('template_id', e.target.value),
                                required: true
                            },
                                React.createElement('option', { value: '' }, 'Selecione um template'),
                                templates.map(template =>
                                    React.createElement('option', { 
                                        key: template.id, 
                                        value: template.id 
                                    }, template.name)
                                )
                            ),
                            templates.length === 0 && React.createElement('p', { 
                                className: 'text-xs text-gray-500 mt-1' 
                            }, 'Nenhum template aprovado disponível.')
                        )
                    ),
                    React.createElement('div', { className: 'input-group' },
                        React.createElement('label', { className: 'input-label' }, 'Agendamento (Opcional)'),
                        React.createElement('input', {
                            type: 'datetime-local',
                            className: 'input',
                            value: formData.scheduled_at,
                            onChange: (e) => handleChange('scheduled_at', e.target.value)
                        }),
                        React.createElement('p', { className: 'text-xs text-gray-500 mt-1' },
                            'Deixe vazio para envio imediato após iniciar a campanha'
                        )
                    ),
                    
                    // Variables section (simplified for now)
                    React.createElement('div', { className: 'input-group' },
                        React.createElement('label', { className: 'input-label' }, 'Variáveis do Template'),
                        React.createElement('div', { className: 'p-3 bg-gray-50 rounded' },
                            React.createElement('p', { className: 'text-sm text-gray-600' },
                                'As variáveis serão preenchidas automaticamente com dados dos contatos. ' +
                                'Configuração avançada em desenvolvimento.'
                            )
                        )
                    )
                ),
                React.createElement('div', { className: 'modal-footer' },
                    React.createElement('button', {
                        type: 'button',
                        className: 'btn btn-secondary',
                        onClick: onClose
                    }, 'Cancelar'),
                    React.createElement('button', {
                        type: 'submit',
                        className: 'btn btn-primary',
                        disabled: creating || !formData.segment_id || !formData.template_id
                    },
                        creating && React.createElement('div', { className: 'spinner mr-2' }),
                        creating ? 'Criando...' : 'Criar Campanha'
                    )
                )
            )
        )
    );
};

// Campaign Detail Modal Component
const CampaignDetailModal = ({ campaign, onClose, onAction }) => {
    return React.createElement('div', { className: 'modal-overlay', onClick: onClose },
        React.createElement('div', { 
            className: 'modal', 
            onClick: (e) => e.stopPropagation(),
            style: { maxWidth: '700px' }
        },
            React.createElement('div', { className: 'modal-header' },
                React.createElement('h3', { className: 'text-lg font-semibold' }, 'Detalhes da Campanha'),
                React.createElement('button', {
                    className: 'text-gray-500 hover:text-gray-700',
                    onClick: onClose
                },
                    React.createElement('i', { className: 'fas fa-times' })
                )
            ),
            React.createElement('div', { className: 'modal-body' },
                React.createElement('div', { className: 'space-y-6' },
                    // Campaign info
                    React.createElement('div', null,
                        React.createElement('div', { className: 'flex items-center justify-between mb-3' },
                            React.createElement('h4', { className: 'text-xl font-semibold' }, campaign.name),
                            React.createElement('span', { 
                                className: `badge ${utils.getStatusBadge(campaign.status)}` 
                            }, utils.getStatusText(campaign.status))
                        ),
                        campaign.description && React.createElement('p', { 
                            className: 'text-gray-600' 
                        }, campaign.description)
                    ),

                    // Progress and stats
                    React.createElement('div', { className: 'grid grid-cols-1 md:grid-cols-3 gap-4' },
                        React.createElement('div', { className: 'bg-gray-50 p-3 rounded' },
                            React.createElement('div', { className: 'text-sm font-medium text-gray-600' }, 'Progresso'),
                            React.createElement('div', { className: 'text-2xl font-bold text-gray-900' },
                                `${campaign.progress || 0}%`
                            ),
                            React.createElement('div', { className: 'progress mt-2' },
                                React.createElement('div', {
                                    className: 'progress-bar',
                                    style: { width: `${campaign.progress || 0}%` }
                                })
                            )
                        ),
                        React.createElement('div', { className: 'bg-gray-50 p-3 rounded' },
                            React.createElement('div', { className: 'text-sm font-medium text-gray-600' }, 'Enviadas'),
                            React.createElement('div', { className: 'text-2xl font-bold text-gray-900' },
                                campaign.sent || 0
                            ),
                            React.createElement('div', { className: 'text-sm text-gray-500' },
                                `de ${campaign.total || 0} total`
                            )
                        ),
                        React.createElement('div', { className: 'bg-gray-50 p-3 rounded' },
                            React.createElement('div', { className: 'text-sm font-medium text-gray-600' }, 'Taxa de Entrega'),
                            React.createElement('div', { className: 'text-2xl font-bold text-gray-900' },
                                `${campaign.delivery_rate || 0}%`
                            ),
                            React.createElement('div', { className: 'text-sm text-gray-500' },
                                'Delivered/Sent'
                            )
                        )
                    ),

                    // Campaign details
                    React.createElement('div', { className: 'grid grid-cols-1 md:grid-cols-2 gap-4' },
                        React.createElement('div', null,
                            React.createElement('label', { className: 'font-semibold text-gray-700' }, 'Segmento'),
                            React.createElement('p', null, campaign.segment_name || 'N/A')
                        ),
                        React.createElement('div', null,
                            React.createElement('label', { className: 'font-semibold text-gray-700' }, 'Template'),
                            React.createElement('p', null, campaign.template_name || 'N/A')
                        ),
                        React.createElement('div', null,
                            React.createElement('label', { className: 'font-semibold text-gray-700' }, 'Criada em'),
                            React.createElement('p', null, utils.formatDateTime(campaign.created_at))
                        ),
                        campaign.scheduled_at && React.createElement('div', null,
                            React.createElement('label', { className: 'font-semibold text-gray-700' }, 'Agendada para'),
                            React.createElement('p', null, utils.formatDateTime(campaign.scheduled_at))
                        )
                    ),

                    // Metrics (if available)
                    campaign.metrics && React.createElement('div', null,
                        React.createElement('h5', { className: 'font-semibold text-gray-700 mb-3' }, 'Métricas Detalhadas'),
                        React.createElement('div', { className: 'grid grid-cols-2 md:grid-cols-4 gap-4 text-sm' },
                            React.createElement('div', { className: 'text-center' },
                                React.createElement('div', { className: 'text-lg font-semibold text-gray-900' },
                                    campaign.metrics.queued || 0
                                ),
                                React.createElement('div', { className: 'text-gray-600' }, 'Na fila')
                            ),
                            React.createElement('div', { className: 'text-center' },
                                React.createElement('div', { className: 'text-lg font-semibold text-success-600' },
                                    campaign.metrics.delivered || 0
                                ),
                                React.createElement('div', { className: 'text-gray-600' }, 'Entregues')
                            ),
                            React.createElement('div', { className: 'text-center' },
                                React.createElement('div', { className: 'text-lg font-semibold text-primary-600' },
                                    campaign.metrics.read || 0
                                ),
                                React.createElement('div', { className: 'text-gray-600' }, 'Lidas')
                            ),
                            React.createElement('div', { className: 'text-center' },
                                React.createElement('div', { className: 'text-lg font-semibold text-error-600' },
                                    campaign.metrics.failed || 0
                                ),
                                React.createElement('div', { className: 'text-gray-600' }, 'Falharam')
                            )
                        )
                    )
                )
            ),
            React.createElement('div', { className: 'modal-footer' },
                React.createElement('div', { className: 'flex gap-2' },
                    campaign.status === 'draft' && React.createElement('button', {
                        className: 'btn btn-success',
                        onClick: () => {
                            onAction(campaign.id, 'start');
                            onClose();
                        }
                    }, 'Iniciar Campanha'),
                    campaign.status === 'active' && React.createElement('button', {
                        className: 'btn btn-warning',
                        onClick: () => {
                            onAction(campaign.id, 'pause');
                            onClose();
                        }
                    }, 'Pausar'),
                    campaign.status === 'paused' && React.createElement('button', {
                        className: 'btn btn-success',
                        onClick: () => {
                            onAction(campaign.id, 'resume');
                            onClose();
                        }
                    }, 'Retomar'),
                    ['active', 'paused'].includes(campaign.status) && React.createElement('button', {
                        className: 'btn btn-error',
                        onClick: () => {
                            if (confirm('Tem certeza que deseja parar esta campanha?')) {
                                onAction(campaign.id, 'stop');
                                onClose();
                            }
                        }
                    }, 'Parar')
                ),
                React.createElement('button', {
                    className: 'btn btn-secondary ml-auto',
                    onClick: onClose
                }, 'Fechar')
            )
        )
    );
};