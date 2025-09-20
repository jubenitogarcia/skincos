// Segments component for Phase 4 implementation
const { useState, useEffect } = React;

const Segments = () => {
    const [segments, setSegments] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [showCreateModal, setShowCreateModal] = useState(false);
    const [selectedSegment, setSelectedSegment] = useState(null);
    const [showDetailModal, setShowDetailModal] = useState(false);

    const loadSegments = async () => {
        try {
            setLoading(true);
            setError(null);
            const response = await API.segments.list();
            setSegments(response.segments || []);
        } catch (err) {
            console.error('Error loading segments:', err);
            setError(err.message);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        loadSegments();
    }, []);

    const handleCreateSegment = async (segmentData) => {
        try {
            await API.segments.create(segmentData);
            utils.showToast('Segmento criado com sucesso!', 'success');
            setShowCreateModal(false);
            loadSegments();
        } catch (err) {
            utils.showToast(`Erro ao criar segmento: ${err.message}`, 'error');
        }
    };

    const handleRefreshSegment = async (segmentId) => {
        try {
            await API.segments.refresh(segmentId);
            utils.showToast('Segmento atualizado!', 'success');
            loadSegments();
        } catch (err) {
            utils.showToast(`Erro ao atualizar segmento: ${err.message}`, 'error');
        }
    };

    const handleViewSegment = async (segment) => {
        try {
            const detailed = await API.segments.get(segment.id);
            setSelectedSegment(detailed);
            setShowDetailModal(true);
        } catch (err) {
            utils.showToast(`Erro ao carregar detalhes: ${err.message}`, 'error');
        }
    };

    if (loading && segments.length === 0) {
        return React.createElement('div', { className: 'flex items-center justify-center h-64' },
            React.createElement('div', { className: 'text-center' },
                React.createElement('div', { className: 'spinner mb-4' }),
                React.createElement('p', { className: 'text-gray-600' }, 'Carregando segmentos...')
            )
        );
    }

    return React.createElement('div', null,
        // Page header
        React.createElement('div', { className: 'page-header' },
            React.createElement('h2', { className: 'page-title' }, 'Segmentos'),
            React.createElement('p', { className: 'page-subtitle' }, 
                'Crie grupos de contatos baseados em critérios específicos'
            ),
            React.createElement('div', { className: 'page-actions' },
                React.createElement('button', {
                    className: 'btn btn-secondary btn-sm',
                    onClick: loadSegments
                },
                    React.createElement('i', { className: 'fas fa-sync-alt mr-2' }),
                    'Atualizar'
                ),
                React.createElement('button', {
                    className: 'btn btn-primary',
                    onClick: () => setShowCreateModal(true)
                },
                    React.createElement('i', { className: 'fas fa-plus mr-2' }),
                    'Novo Segmento'
                )
            )
        ),

        // Info card about segments
        React.createElement('div', { className: 'card mb-6 border-primary-200 bg-primary-50' },
            React.createElement('div', { className: 'card-body p-4' },
                React.createElement('div', { className: 'flex items-start gap-3' },
                    React.createElement('i', { className: 'fas fa-info-circle text-primary-600 mt-1' }),
                    React.createElement('div', null,
                        React.createElement('h4', { className: 'font-semibold text-primary-900 mb-2' }, 
                            'Como funcionam os Segmentos'
                        ),
                        React.createElement('p', { className: 'text-primary-800 text-sm' },
                            'Use segmentos para criar grupos dinâmicos de contatos baseados em tags, ' +
                            'datas de criação, empresas ou outros critérios. Ideal para campanhas direcionadas.'
                        )
                    )
                )
            )
        ),

        // Segment stats
        React.createElement('div', { className: 'stats-grid mb-6' },
            React.createElement('div', { className: 'stats-card' },
                React.createElement('div', { className: 'stats-header' },
                    React.createElement('span', { className: 'stats-title' }, 'Total de Segmentos'),
                    React.createElement('div', { className: 'stats-icon primary' },
                        React.createElement('i', { className: 'fas fa-users' })
                    )
                ),
                React.createElement('div', { className: 'stats-value' },
                    segments.length
                ),
                React.createElement('div', { className: 'stats-change positive' },
                    React.createElement('i', { className: 'fas fa-chart-line' }),
                    'Grupos criados'
                )
            ),
            React.createElement('div', { className: 'stats-card' },
                React.createElement('div', { className: 'stats-header' },
                    React.createElement('span', { className: 'stats-title' }, 'Contatos Segmentados'),
                    React.createElement('div', { className: 'stats-icon success' },
                        React.createElement('i', { className: 'fas fa-user-check' })
                    )
                ),
                React.createElement('div', { className: 'stats-value' },
                    utils.formatNumber(
                        segments.reduce((total, seg) => total + (seg.contact_count || 0), 0)
                    )
                ),
                React.createElement('div', { className: 'stats-change positive' },
                    React.createElement('i', { className: 'fas fa-arrow-up' }),
                    'Contatos únicos'
                )
            ),
            React.createElement('div', { className: 'stats-card' },
                React.createElement('div', { className: 'stats-header' },
                    React.createElement('span', { className: 'stats-title' }, 'Maior Segmento'),
                    React.createElement('div', { className: 'stats-icon warning' },
                        React.createElement('i', { className: 'fas fa-crown' })
                    )
                ),
                React.createElement('div', { className: 'stats-value' },
                    utils.formatNumber(
                        Math.max(...segments.map(seg => seg.contact_count || 0), 0)
                    )
                ),
                React.createElement('div', { className: 'stats-change neutral' },
                    React.createElement('i', { className: 'fas fa-users' }),
                    'Contatos'
                )
            )
        ),

        // Segments grid
        React.createElement('div', { className: 'data-table' },
            React.createElement('div', { className: 'table-header' },
                React.createElement('h3', { className: 'table-title' }, 'Seus Segmentos'),
                React.createElement('div', { className: 'table-filters' },
                    React.createElement('span', { className: 'text-sm text-gray-600' },
                        `${segments.length} segmentos`
                    )
                )
            ),
            error && React.createElement('div', { className: 'p-4 bg-error-50 border border-error-200 rounded-lg' },
                React.createElement('div', { className: 'flex items-center gap-2 text-error-700' },
                    React.createElement('i', { className: 'fas fa-exclamation-triangle' }),
                    React.createElement('span', null, error)
                )
            ),
            segments.length > 0 ? 
                React.createElement('div', { className: 'grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 p-6' },
                    segments.map(segment =>
                        React.createElement('div', { 
                            key: segment.id, 
                            className: 'card hover:shadow-lg transition-shadow cursor-pointer',
                            onClick: () => handleViewSegment(segment)
                        },
                            React.createElement('div', { className: 'card-body' },
                                React.createElement('div', { className: 'flex items-start justify-between mb-3' },
                                    React.createElement('h4', { className: 'font-semibold text-gray-900 truncate pr-2' },
                                        segment.name || 'Segmento sem nome'
                                    ),
                                    React.createElement('div', { className: 'flex items-center gap-2' },
                                        React.createElement('span', { className: 'badge badge-primary text-xs' },
                                            `${segment.contact_count || 0} contatos`
                                        )
                                    )
                                ),
                                segment.description && React.createElement('p', { 
                                    className: 'text-sm text-gray-600 mb-3 line-clamp-2' 
                                }, segment.description),
                                React.createElement('div', { className: 'mb-4' },
                                    React.createElement('div', { className: 'text-xs font-medium text-gray-700 mb-1' }, 
                                        'Critérios'
                                    ),
                                    React.createElement('div', { className: 'text-sm text-gray-600 bg-gray-50 p-2 rounded font-mono' },
                                        segment.query ? utils.truncate(JSON.stringify(segment.query), 60) : 'Nenhum critério'
                                    )
                                ),
                                React.createElement('div', { className: 'flex items-center justify-between' },
                                    React.createElement('span', { className: 'text-xs text-gray-500' },
                                        utils.getRelativeTime(segment.updated_at || segment.created_at)
                                    ),
                                    React.createElement('div', { className: 'flex gap-2' },
                                        React.createElement('button', {
                                            className: 'action-btn edit',
                                            title: 'Atualizar contagem',
                                            onClick: (e) => {
                                                e.stopPropagation();
                                                handleRefreshSegment(segment.id);
                                            }
                                        },
                                            React.createElement('i', { className: 'fas fa-sync-alt' })
                                        )
                                    )
                                )
                            )
                        )
                    )
                ) :
                React.createElement('div', { className: 'empty-state' },
                    React.createElement('i', { className: 'fas fa-users empty-state-icon' }),
                    React.createElement('h3', { className: 'empty-state-title' }, 'Nenhum segmento encontrado'),
                    React.createElement('p', { className: 'empty-state-description' }, 
                        'Crie seu primeiro segmento para agrupar contatos por critérios específicos'
                    ),
                    React.createElement('button', {
                        className: 'btn btn-primary',
                        onClick: () => setShowCreateModal(true)
                    },
                        React.createElement('i', { className: 'fas fa-plus mr-2' }),
                        'Criar primeiro segmento'
                    )
                )
        ),

        // Create Segment Modal
        showCreateModal && React.createElement(CreateSegmentModal, {
            onClose: () => setShowCreateModal(false),
            onCreate: handleCreateSegment
        }),

        // Segment Detail Modal
        showDetailModal && selectedSegment && React.createElement(SegmentDetailModal, {
            segment: selectedSegment,
            onClose: () => {
                setShowDetailModal(false);
                setSelectedSegment(null);
            },
            onRefresh: handleRefreshSegment
        })
    );
};

// Create Segment Modal Component
const CreateSegmentModal = ({ onClose, onCreate }) => {
    const [formData, setFormData] = useState({
        name: '',
        description: '',
        query: {
            tags: [],
            company: '',
            created_after: '',
            created_before: ''
        }
    });
    const [creating, setCreating] = useState(false);
    const [testResult, setTestResult] = useState(null);
    const [testing, setTesting] = useState(false);

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

    const handleQueryChange = (key, value) => {
        setFormData(prev => ({
            ...prev,
            query: { ...prev.query, [key]: value }
        }));
        setTestResult(null); // Clear test result when query changes
    };

    const handleTestQuery = async () => {
        setTesting(true);
        try {
            const result = await API.segments.testQuery(formData.query);
            setTestResult(result);
        } catch (err) {
            utils.showToast(`Erro no teste: ${err.message}`, 'error');
        } finally {
            setTesting(false);
        }
    };

    const addTag = (tag) => {
        if (tag && !formData.query.tags.includes(tag)) {
            handleQueryChange('tags', [...formData.query.tags, tag]);
        }
    };

    const removeTag = (tagToRemove) => {
        handleQueryChange('tags', formData.query.tags.filter(tag => tag !== tagToRemove));
    };

    return React.createElement('div', { className: 'modal-overlay', onClick: onClose },
        React.createElement('div', { 
            className: 'modal', 
            onClick: (e) => e.stopPropagation(),
            style: { maxWidth: '700px', maxHeight: '90vh', overflowY: 'auto' }
        },
            React.createElement('div', { className: 'modal-header' },
                React.createElement('h3', { className: 'text-lg font-semibold' }, 'Novo Segmento'),
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
                        React.createElement('label', { className: 'input-label' }, 'Nome do Segmento *'),
                        React.createElement('input', {
                            type: 'text',
                            className: 'input',
                            placeholder: 'ex: Clientes VIP São Paulo',
                            value: formData.name,
                            onChange: (e) => handleChange('name', e.target.value),
                            required: true
                        })
                    ),
                    
                    React.createElement('div', { className: 'input-group' },
                        React.createElement('label', { className: 'input-label' }, 'Descrição'),
                        React.createElement('textarea', {
                            className: 'input textarea',
                            rows: 2,
                            placeholder: 'Descrição opcional do segmento...',
                            value: formData.description,
                            onChange: (e) => handleChange('description', e.target.value)
                        })
                    ),

                    React.createElement('div', { className: 'mb-4' },
                        React.createElement('h4', { className: 'font-semibold text-gray-900 mb-3' }, 'Critérios de Segmentação')
                    ),

                    // Tags filter
                    React.createElement('div', { className: 'input-group' },
                        React.createElement('label', { className: 'input-label' }, 'Tags (contatos que possuem TODAS as tags)'),
                        React.createElement('div', { className: 'flex flex-wrap gap-2 mb-2' },
                            formData.query.tags.map(tag =>
                                React.createElement('span', {
                                    key: tag,
                                    className: 'badge badge-primary flex items-center gap-1'
                                },
                                    tag,
                                    React.createElement('button', {
                                        type: 'button',
                                        className: 'text-primary-200 hover:text-white',
                                        onClick: () => removeTag(tag)
                                    },
                                        React.createElement('i', { className: 'fas fa-times text-xs' })
                                    )
                                )
                            )
                        ),
                        React.createElement('div', { className: 'flex gap-2' },
                            ['lead', 'cliente', 'prospect', 'vip', 'ativo'].map(tag =>
                                React.createElement('button', {
                                    key: tag,
                                    type: 'button',
                                    className: `btn btn-sm ${formData.query.tags.includes(tag) ? 'btn-primary' : 'btn-secondary'}`,
                                    onClick: () => formData.query.tags.includes(tag) ? removeTag(tag) : addTag(tag)
                                },
                                    tag.charAt(0).toUpperCase() + tag.slice(1)
                                )
                            )
                        )
                    ),

                    // Company filter
                    React.createElement('div', { className: 'input-group' },
                        React.createElement('label', { className: 'input-label' }, 'Empresa (contém texto)'),
                        React.createElement('input', {
                            type: 'text',
                            className: 'input',
                            placeholder: 'Ex: Google, Microsoft...',
                            value: formData.query.company,
                            onChange: (e) => handleQueryChange('company', e.target.value)
                        })
                    ),

                    // Date filters
                    React.createElement('div', { className: 'grid grid-cols-1 md:grid-cols-2 gap-4' },
                        React.createElement('div', { className: 'input-group' },
                            React.createElement('label', { className: 'input-label' }, 'Criado após'),
                            React.createElement('input', {
                                type: 'date',
                                className: 'input',
                                value: formData.query.created_after,
                                onChange: (e) => handleQueryChange('created_after', e.target.value)
                            })
                        ),
                        React.createElement('div', { className: 'input-group' },
                            React.createElement('label', { className: 'input-label' }, 'Criado antes'),
                            React.createElement('input', {
                                type: 'date',
                                className: 'input',
                                value: formData.query.created_before,
                                onChange: (e) => handleQueryChange('created_before', e.target.value)
                            })
                        )
                    ),

                    // Test query section
                    React.createElement('div', { className: 'mt-6 p-4 bg-gray-50 rounded-lg' },
                        React.createElement('div', { className: 'flex items-center justify-between mb-3' },
                            React.createElement('h4', { className: 'font-semibold' }, 'Testar Segmento'),
                            React.createElement('button', {
                                type: 'button',
                                className: 'btn btn-secondary btn-sm',
                                onClick: handleTestQuery,
                                disabled: testing
                            },
                                testing && React.createElement('div', { className: 'spinner mr-2' }),
                                testing ? 'Testando...' : 'Testar Query'
                            )
                        ),
                        testResult && React.createElement('div', { 
                            className: `p-3 rounded ${testResult.count > 0 ? 'bg-success-50 border border-success-200' : 'bg-warning-50 border border-warning-200'}` 
                        },
                            React.createElement('div', { className: 'flex items-center gap-2' },
                                React.createElement('i', { 
                                    className: `fas ${testResult.count > 0 ? 'fa-check-circle text-success-600' : 'fa-exclamation-triangle text-warning-600'}` 
                                }),
                                React.createElement('span', { 
                                    className: testResult.count > 0 ? 'text-success-800' : 'text-warning-800' 
                                },
                                    `${testResult.count || 0} contatos encontrados com estes critérios`
                                )
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
                        disabled: creating
                    },
                        creating && React.createElement('div', { className: 'spinner mr-2' }),
                        creating ? 'Criando...' : 'Criar Segmento'
                    )
                )
            )
        )
    );
};

// Segment Detail Modal Component
const SegmentDetailModal = ({ segment, onClose, onRefresh }) => {
    return React.createElement('div', { className: 'modal-overlay', onClick: onClose },
        React.createElement('div', { 
            className: 'modal', 
            onClick: (e) => e.stopPropagation(),
            style: { maxWidth: '600px' }
        },
            React.createElement('div', { className: 'modal-header' },
                React.createElement('h3', { className: 'text-lg font-semibold' }, 'Detalhes do Segmento'),
                React.createElement('button', {
                    className: 'text-gray-500 hover:text-gray-700',
                    onClick: onClose
                },
                    React.createElement('i', { className: 'fas fa-times' })
                )
            ),
            React.createElement('div', { className: 'modal-body' },
                React.createElement('div', { className: 'space-y-4' },
                    React.createElement('div', { className: 'flex items-center justify-between' },
                        React.createElement('h4', { className: 'text-xl font-semibold' }, segment.name),
                        React.createElement('span', { className: 'badge badge-primary text-lg px-3 py-1' },
                            `${segment.contact_count || 0} contatos`
                        )
                    ),
                    
                    segment.description && React.createElement('div', null,
                        React.createElement('label', { className: 'font-semibold text-gray-700' }, 'Descrição'),
                        React.createElement('p', { className: 'text-gray-600' }, segment.description)
                    ),

                    React.createElement('div', null,
                        React.createElement('label', { className: 'font-semibold text-gray-700 mb-2 block' }, 'Critérios'),
                        React.createElement('div', { className: 'bg-gray-50 p-4 rounded-lg border' },
                            segment.query?.tags?.length > 0 && React.createElement('div', { className: 'mb-3' },
                                React.createElement('div', { className: 'text-sm font-medium text-gray-700 mb-1' }, 'Tags:'),
                                React.createElement('div', { className: 'flex flex-wrap gap-1' },
                                    segment.query.tags.map(tag =>
                                        React.createElement('span', {
                                            key: tag,
                                            className: 'badge badge-primary text-xs'
                                        }, tag)
                                    )
                                )
                            ),
                            segment.query?.company && React.createElement('div', { className: 'mb-3' },
                                React.createElement('div', { className: 'text-sm font-medium text-gray-700 mb-1' }, 'Empresa contém:'),
                                React.createElement('div', { className: 'text-sm text-gray-600' }, `"${segment.query.company}"`)
                            ),
                            (segment.query?.created_after || segment.query?.created_before) && React.createElement('div', { className: 'mb-3' },
                                React.createElement('div', { className: 'text-sm font-medium text-gray-700 mb-1' }, 'Data de criação:'),
                                React.createElement('div', { className: 'text-sm text-gray-600' },
                                    `${segment.query.created_after ? 'Após ' + utils.formatDate(segment.query.created_after) : ''}${segment.query.created_after && segment.query.created_before ? ' e ' : ''}${segment.query.created_before ? 'Antes de ' + utils.formatDate(segment.query.created_before) : ''}`
                                )
                            ),
                            (!segment.query?.tags?.length && !segment.query?.company && !segment.query?.created_after && !segment.query?.created_before) &&
                            React.createElement('div', { className: 'text-sm text-gray-500 italic' }, 'Nenhum critério específico - todos os contatos')
                        )
                    ),

                    // Sample contacts (if available)
                    segment.sample_contacts && segment.sample_contacts.length > 0 && React.createElement('div', null,
                        React.createElement('label', { className: 'font-semibold text-gray-700 mb-2 block' }, 'Exemplos de Contatos'),
                        React.createElement('div', { className: 'space-y-2' },
                            segment.sample_contacts.slice(0, 5).map(contact =>
                                React.createElement('div', {
                                    key: contact.id,
                                    className: 'flex items-center gap-3 p-2 bg-gray-50 rounded'
                                },
                                    React.createElement('div', { 
                                        className: 'avatar avatar-sm bg-primary-500' 
                                    }, (contact.first_name || 'U').charAt(0).toUpperCase()),
                                    React.createElement('div', { className: 'flex-1' },
                                        React.createElement('div', { className: 'font-medium text-sm' },
                                            `${contact.first_name || 'Unnamed'} ${contact.last_name || ''}`
                                        ),
                                        contact.company && React.createElement('div', { className: 'text-xs text-gray-500' },
                                            contact.company
                                        )
                                    ),
                                    contact.tags?.length > 0 && React.createElement('div', { className: 'flex gap-1' },
                                        contact.tags.slice(0, 2).map(tag =>
                                            React.createElement('span', {
                                                key: tag,
                                                className: 'badge badge-gray text-xs'
                                            }, tag)
                                        )
                                    )
                                )
                            ),
                            segment.contact_count > 5 && React.createElement('div', { 
                                className: 'text-xs text-gray-500 text-center' 
                            }, `... e mais ${segment.contact_count - 5} contatos`)
                        )
                    ),

                    React.createElement('div', null,
                        React.createElement('label', { className: 'font-semibold text-gray-700' }, 'Criado em'),
                        React.createElement('p', null, utils.formatDateTime(segment.created_at))
                    ),
                    
                    segment.updated_at && React.createElement('div', null,
                        React.createElement('label', { className: 'font-semibold text-gray-700' }, 'Última atualização'),
                        React.createElement('p', null, utils.formatDateTime(segment.updated_at))
                    )
                )
            ),
            React.createElement('div', { className: 'modal-footer' },
                React.createElement('button', {
                    className: 'btn btn-secondary',
                    onClick: () => {
                        onRefresh(segment.id);
                        onClose();
                    }
                }, 'Atualizar Contagem'),
                React.createElement('button', {
                    className: 'btn btn-secondary',
                    onClick: onClose
                }, 'Fechar')
            )
        )
    );
};