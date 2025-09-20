// Templates component for Phase 4 implementation
const { useState, useEffect } = React;

const Templates = () => {
    const [templates, setTemplates] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [filters, setFilters] = useState({
        status: '',
        category: '',
        language: 'pt_BR'
    });
    const [showCreateModal, setShowCreateModal] = useState(false);
    const [selectedTemplate, setSelectedTemplate] = useState(null);
    const [showDetailModal, setShowDetailModal] = useState(false);

    const loadTemplates = async () => {
        try {
            setLoading(true);
            setError(null);
            const response = await API.templates.list(filters);
            setTemplates(response.templates || []);
        } catch (err) {
            console.error('Error loading templates:', err);
            setError(err.message);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        loadTemplates();
    }, [filters]);

    const handleFilterChange = (key, value) => {
        setFilters(prev => ({ ...prev, [key]: value }));
    };

    const handleCreateTemplate = async (templateData) => {
        try {
            await API.templates.create(templateData);
            utils.showToast('Template criado com sucesso!', 'success');
            setShowCreateModal(false);
            loadTemplates();
        } catch (err) {
            utils.showToast(`Erro ao criar template: ${err.message}`, 'error');
        }
    };

    const handleSubmitTemplate = async (templateId) => {
        try {
            await API.templates.submit(templateId);
            utils.showToast('Template enviado para aprovação!', 'success');
            loadTemplates();
        } catch (err) {
            utils.showToast(`Erro ao enviar template: ${err.message}`, 'error');
        }
    };

    const handleViewTemplate = (template) => {
        setSelectedTemplate(template);
        setShowDetailModal(true);
    };

    if (loading && templates.length === 0) {
        return React.createElement('div', { className: 'flex items-center justify-center h-64' },
            React.createElement('div', { className: 'text-center' },
                React.createElement('div', { className: 'spinner mb-4' }),
                React.createElement('p', { className: 'text-gray-600' }, 'Carregando templates...')
            )
        );
    }

    return React.createElement('div', null,
        // Page header
        React.createElement('div', { className: 'page-header' },
            React.createElement('h2', { className: 'page-title' }, 'Templates'),
            React.createElement('p', { className: 'page-subtitle' }, 
                'Gerencie templates de mensagens para WhatsApp Business'
            ),
            React.createElement('div', { className: 'page-actions' },
                React.createElement('button', {
                    className: 'btn btn-secondary btn-sm',
                    onClick: loadTemplates
                },
                    React.createElement('i', { className: 'fas fa-sync-alt mr-2' }),
                    'Atualizar'
                ),
                React.createElement('button', {
                    className: 'btn btn-primary',
                    onClick: () => setShowCreateModal(true)
                },
                    React.createElement('i', { className: 'fas fa-plus mr-2' }),
                    'Novo Template'
                )
            )
        ),

        // Info card about WhatsApp templates
        React.createElement('div', { className: 'card mb-6 border-primary-200 bg-primary-50' },
            React.createElement('div', { className: 'card-body p-4' },
                React.createElement('div', { className: 'flex items-start gap-3' },
                    React.createElement('i', { className: 'fas fa-info-circle text-primary-600 mt-1' }),
                    React.createElement('div', null,
                        React.createElement('h4', { className: 'font-semibold text-primary-900 mb-2' }, 
                            'Sobre Templates WhatsApp'
                        ),
                        React.createElement('p', { className: 'text-primary-800 text-sm' },
                            'Templates precisam ser aprovados pelo WhatsApp antes de serem usados. ' +
                            'Suporte a placeholders {{1}}, {{2}} e categorias: marketing, utility, authentication.'
                        )
                    )
                )
            )
        ),

        // Filters
        React.createElement('div', { className: 'card mb-6' },
            React.createElement('div', { className: 'card-body' },
                React.createElement('div', { className: 'grid grid-cols-1 md:grid-cols-4 gap-4' },
                    React.createElement('div', null,
                        React.createElement('label', { className: 'input-label' }, 'Status'),
                        React.createElement('select', {
                            className: 'input select',
                            value: filters.status,
                            onChange: (e) => handleFilterChange('status', e.target.value)
                        },
                            React.createElement('option', { value: '' }, 'Todos'),
                            React.createElement('option', { value: 'draft' }, 'Rascunho'),
                            React.createElement('option', { value: 'pending' }, 'Aguardando aprovação'),
                            React.createElement('option', { value: 'approved' }, 'Aprovado'),
                            React.createElement('option', { value: 'rejected' }, 'Rejeitado')
                        )
                    ),
                    React.createElement('div', null,
                        React.createElement('label', { className: 'input-label' }, 'Categoria'),
                        React.createElement('select', {
                            className: 'input select',
                            value: filters.category,
                            onChange: (e) => handleFilterChange('category', e.target.value)
                        },
                            React.createElement('option', { value: '' }, 'Todas'),
                            React.createElement('option', { value: 'marketing' }, 'Marketing'),
                            React.createElement('option', { value: 'utility' }, 'Utilitário'),
                            React.createElement('option', { value: 'authentication' }, 'Autenticação')
                        )
                    ),
                    React.createElement('div', null,
                        React.createElement('label', { className: 'input-label' }, 'Idioma'),
                        React.createElement('select', {
                            className: 'input select',
                            value: filters.language,
                            onChange: (e) => handleFilterChange('language', e.target.value)
                        },
                            React.createElement('option', { value: 'pt_BR' }, 'Português'),
                            React.createElement('option', { value: 'en_US' }, 'Inglês'),
                            React.createElement('option', { value: 'es_ES' }, 'Espanhol')
                        )
                    ),
                    React.createElement('div', { className: 'flex items-end' },
                        React.createElement('button', {
                            className: 'btn btn-secondary w-full',
                            onClick: () => setFilters({
                                status: '',
                                category: '',
                                language: 'pt_BR'
                            })
                        }, 'Limpar Filtros')
                    )
                )
            )
        ),

        // Templates grid
        React.createElement('div', { className: 'data-table' },
            React.createElement('div', { className: 'table-header' },
                React.createElement('h3', { className: 'table-title' }, 'Seus Templates'),
                React.createElement('div', { className: 'table-filters' },
                    React.createElement('span', { className: 'text-sm text-gray-600' },
                        `${templates.length} templates`
                    )
                )
            ),
            error && React.createElement('div', { className: 'p-4 bg-error-50 border border-error-200 rounded-lg' },
                React.createElement('div', { className: 'flex items-center gap-2 text-error-700' },
                    React.createElement('i', { className: 'fas fa-exclamation-triangle' }),
                    React.createElement('span', null, error)
                )
            ),
            templates.length > 0 ? 
                React.createElement('div', { className: 'grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 p-6' },
                    templates.map(template =>
                        React.createElement('div', { 
                            key: template.id, 
                            className: 'card hover:shadow-lg transition-shadow cursor-pointer',
                            onClick: () => handleViewTemplate(template)
                        },
                            React.createElement('div', { className: 'card-body' },
                                React.createElement('div', { className: 'flex items-start justify-between mb-3' },
                                    React.createElement('h4', { className: 'font-semibold text-gray-900 truncate' },
                                        template.name || 'Template sem nome'
                                    ),
                                    React.createElement('span', { 
                                        className: `badge ${utils.getStatusBadge(template.status)} text-xs` 
                                    }, utils.getStatusText(template.status))
                                ),
                                React.createElement('div', { className: 'flex items-center gap-2 mb-3' },
                                    React.createElement('span', { 
                                        className: 'badge badge-gray text-xs' 
                                    }, template.category || 'utility'),
                                    React.createElement('span', { 
                                        className: 'text-xs text-gray-500' 
                                    }, template.language || 'pt_BR')
                                ),
                                React.createElement('div', { 
                                    className: 'text-sm text-gray-600 mb-4 line-clamp-3' 
                                },
                                    template.body ? utils.truncate(template.body, 120) : 'Sem conteúdo'
                                ),
                                React.createElement('div', { className: 'flex items-center justify-between' },
                                    React.createElement('span', { className: 'text-xs text-gray-500' },
                                        utils.getRelativeTime(template.updated_at || template.created_at)
                                    ),
                                    React.createElement('div', { className: 'flex gap-2' },
                                        template.status === 'draft' && React.createElement('button', {
                                            className: 'action-btn edit',
                                            title: 'Editar',
                                            onClick: (e) => {
                                                e.stopPropagation();
                                                utils.showToast('Funcionalidade em desenvolvimento', 'info');
                                            }
                                        },
                                            React.createElement('i', { className: 'fas fa-edit' })
                                        ),
                                        template.status === 'draft' && React.createElement('button', {
                                            className: 'btn btn-primary btn-sm',
                                            onClick: (e) => {
                                                e.stopPropagation();
                                                handleSubmitTemplate(template.id);
                                            }
                                        }, 'Enviar para Aprovação')
                                    )
                                )
                            )
                        )
                    )
                ) :
                React.createElement('div', { className: 'empty-state' },
                    React.createElement('i', { className: 'fas fa-file-alt empty-state-icon' }),
                    React.createElement('h3', { className: 'empty-state-title' }, 'Nenhum template encontrado'),
                    React.createElement('p', { className: 'empty-state-description' }, 
                        'Crie seu primeiro template para começar a enviar mensagens padronizadas'
                    ),
                    React.createElement('button', {
                        className: 'btn btn-primary',
                        onClick: () => setShowCreateModal(true)
                    },
                        React.createElement('i', { className: 'fas fa-plus mr-2' }),
                        'Criar primeiro template'
                    )
                )
        ),

        // Create Template Modal
        showCreateModal && React.createElement(CreateTemplateModal, {
            onClose: () => setShowCreateModal(false),
            onCreate: handleCreateTemplate
        }),

        // Template Detail Modal
        showDetailModal && selectedTemplate && React.createElement(TemplateDetailModal, {
            template: selectedTemplate,
            onClose: () => {
                setShowDetailModal(false);
                setSelectedTemplate(null);
            },
            onSubmit: handleSubmitTemplate
        })
    );
};

// Create Template Modal Component
const CreateTemplateModal = ({ onClose, onCreate }) => {
    const [formData, setFormData] = useState({
        name: '',
        category: 'utility',
        language: 'pt_BR',
        body: '',
        header: '',
        footer: '',
        buttons: []
    });
    const [creating, setCreating] = useState(false);

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

    const addButton = () => {
        setFormData(prev => ({
            ...prev,
            buttons: [...prev.buttons, { type: 'QUICK_REPLY', text: '' }]
        }));
    };

    const removeButton = (index) => {
        setFormData(prev => ({
            ...prev,
            buttons: prev.buttons.filter((_, i) => i !== index)
        }));
    };

    const updateButton = (index, field, value) => {
        setFormData(prev => ({
            ...prev,
            buttons: prev.buttons.map((btn, i) => 
                i === index ? { ...btn, [field]: value } : btn
            )
        }));
    };

    return React.createElement('div', { className: 'modal-overlay', onClick: onClose },
        React.createElement('div', { 
            className: 'modal', 
            onClick: (e) => e.stopPropagation(),
            style: { maxWidth: '700px', maxHeight: '90vh', overflowY: 'auto' }
        },
            React.createElement('div', { className: 'modal-header' },
                React.createElement('h3', { className: 'text-lg font-semibold' }, 'Novo Template'),
                React.createElement('button', {
                    className: 'text-gray-500 hover:text-gray-700',
                    onClick: onClose
                },
                    React.createElement('i', { className: 'fas fa-times' })
                )
            ),
            React.createElement('form', { onSubmit: handleSubmit },
                React.createElement('div', { className: 'modal-body' },
                    React.createElement('div', { className: 'grid grid-cols-1 md:grid-cols-2 gap-4 mb-4' },
                        React.createElement('div', { className: 'input-group' },
                            React.createElement('label', { className: 'input-label' }, 'Nome do Template *'),
                            React.createElement('input', {
                                type: 'text',
                                className: 'input',
                                placeholder: 'ex: promocao_black_friday',
                                value: formData.name,
                                onChange: (e) => handleChange('name', e.target.value),
                                required: true
                            })
                        ),
                        React.createElement('div', { className: 'input-group' },
                            React.createElement('label', { className: 'input-label' }, 'Categoria *'),
                            React.createElement('select', {
                                className: 'input select',
                                value: formData.category,
                                onChange: (e) => handleChange('category', e.target.value),
                                required: true
                            },
                                React.createElement('option', { value: 'utility' }, 'Utilitário'),
                                React.createElement('option', { value: 'marketing' }, 'Marketing'),
                                React.createElement('option', { value: 'authentication' }, 'Autenticação')
                            )
                        )
                    ),
                    
                    React.createElement('div', { className: 'input-group' },
                        React.createElement('label', { className: 'input-label' }, 'Cabeçalho (Opcional)'),
                        React.createElement('input', {
                            type: 'text',
                            className: 'input',
                            placeholder: 'Cabeçalho do template...',
                            value: formData.header,
                            onChange: (e) => handleChange('header', e.target.value)
                        })
                    ),
                    
                    React.createElement('div', { className: 'input-group' },
                        React.createElement('label', { className: 'input-label' }, 'Corpo da Mensagem *'),
                        React.createElement('textarea', {
                            className: 'input textarea',
                            rows: 4,
                            placeholder: 'Olá {{1}}, sua compra foi confirmada! Use placeholders {{1}}, {{2}}...',
                            value: formData.body,
                            onChange: (e) => handleChange('body', e.target.value),
                            required: true
                        }),
                        React.createElement('p', { className: 'text-xs text-gray-500 mt-1' },
                            'Use placeholders {{1}}, {{2}}, etc. para conteúdo dinâmico'
                        )
                    ),
                    
                    React.createElement('div', { className: 'input-group' },
                        React.createElement('label', { className: 'input-label' }, 'Rodapé (Opcional)'),
                        React.createElement('input', {
                            type: 'text',
                            className: 'input',
                            placeholder: 'Rodapé do template...',
                            value: formData.footer,
                            onChange: (e) => handleChange('footer', e.target.value)
                        })
                    ),

                    // Buttons section
                    React.createElement('div', { className: 'input-group' },
                        React.createElement('div', { className: 'flex items-center justify-between mb-2' },
                            React.createElement('label', { className: 'input-label' }, 'Botões (Opcional)'),
                            React.createElement('button', {
                                type: 'button',
                                className: 'btn btn-secondary btn-sm',
                                onClick: addButton
                            },
                                React.createElement('i', { className: 'fas fa-plus mr-1' }),
                                'Adicionar Botão'
                            )
                        ),
                        formData.buttons.map((button, index) =>
                            React.createElement('div', { 
                                key: index, 
                                className: 'flex items-center gap-2 mb-2' 
                            },
                                React.createElement('select', {
                                    className: 'input select',
                                    style: { flex: '0 0 120px' },
                                    value: button.type,
                                    onChange: (e) => updateButton(index, 'type', e.target.value)
                                },
                                    React.createElement('option', { value: 'QUICK_REPLY' }, 'Resposta Rápida'),
                                    React.createElement('option', { value: 'URL' }, 'URL'),
                                    React.createElement('option', { value: 'PHONE_NUMBER' }, 'Telefone')
                                ),
                                React.createElement('input', {
                                    type: 'text',
                                    className: 'input',
                                    placeholder: 'Texto do botão...',
                                    value: button.text,
                                    onChange: (e) => updateButton(index, 'text', e.target.value)
                                }),
                                React.createElement('button', {
                                    type: 'button',
                                    className: 'action-btn delete',
                                    onClick: () => removeButton(index)
                                },
                                    React.createElement('i', { className: 'fas fa-trash' })
                                )
                            )
                        )
                    ),

                    // Preview section
                    React.createElement('div', { className: 'mt-6 p-4 bg-gray-50 rounded-lg' },
                        React.createElement('h4', { className: 'font-semibold mb-3' }, 'Preview'),
                        React.createElement('div', { className: 'bg-white p-3 rounded border' },
                            formData.header && React.createElement('div', { 
                                className: 'font-semibold text-gray-900 mb-2' 
                            }, formData.header),
                            React.createElement('div', { className: 'text-gray-800 mb-2' },
                                formData.body || 'Digite o corpo da mensagem...'
                            ),
                            formData.footer && React.createElement('div', { 
                                className: 'text-sm text-gray-600 mb-2' 
                            }, formData.footer),
                            formData.buttons.length > 0 && React.createElement('div', { 
                                className: 'flex flex-wrap gap-2' 
                            },
                                formData.buttons.map((button, index) =>
                                    button.text && React.createElement('span', {
                                        key: index,
                                        className: 'px-3 py-1 bg-blue-100 text-blue-800 rounded text-sm border'
                                    }, button.text)
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
                        creating ? 'Criando...' : 'Criar Template'
                    )
                )
            )
        )
    );
};

// Template Detail Modal Component
const TemplateDetailModal = ({ template, onClose, onSubmit }) => {
    return React.createElement('div', { className: 'modal-overlay', onClick: onClose },
        React.createElement('div', { 
            className: 'modal', 
            onClick: (e) => e.stopPropagation(),
            style: { maxWidth: '600px' }
        },
            React.createElement('div', { className: 'modal-header' },
                React.createElement('h3', { className: 'text-lg font-semibold' }, 'Detalhes do Template'),
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
                        React.createElement('h4', { className: 'text-xl font-semibold' }, template.name),
                        React.createElement('span', { 
                            className: `badge ${utils.getStatusBadge(template.status)}` 
                        }, utils.getStatusText(template.status))
                    ),
                    React.createElement('div', { className: 'grid grid-cols-2 gap-4' },
                        React.createElement('div', null,
                            React.createElement('label', { className: 'font-semibold text-gray-700' }, 'Categoria'),
                            React.createElement('p', null, template.category || 'utility')
                        ),
                        React.createElement('div', null,
                            React.createElement('label', { className: 'font-semibold text-gray-700' }, 'Idioma'),
                            React.createElement('p', null, template.language || 'pt_BR')
                        )
                    ),
                    
                    // Template preview
                    React.createElement('div', null,
                        React.createElement('label', { className: 'font-semibold text-gray-700 mb-2 block' }, 'Preview'),
                        React.createElement('div', { className: 'bg-gray-50 p-4 rounded-lg border' },
                            template.header && React.createElement('div', { 
                                className: 'font-semibold text-gray-900 mb-2 pb-2 border-b border-gray-200' 
                            }, template.header),
                            React.createElement('div', { className: 'text-gray-800 mb-3' },
                                template.body || 'Sem conteúdo'
                            ),
                            template.footer && React.createElement('div', { 
                                className: 'text-sm text-gray-600 mb-3 pt-2 border-t border-gray-200' 
                            }, template.footer),
                            template.buttons?.length > 0 && React.createElement('div', null,
                                React.createElement('div', { className: 'text-sm font-medium text-gray-700 mb-2' }, 'Botões:'),
                                React.createElement('div', { className: 'flex flex-wrap gap-2' },
                                    template.buttons.map((button, index) =>
                                        React.createElement('span', {
                                            key: index,
                                            className: 'px-3 py-1 bg-blue-100 text-blue-800 rounded text-sm border'
                                        }, `[${button.type}] ${button.text}`)
                                    )
                                )
                            )
                        )
                    ),
                    
                    React.createElement('div', null,
                        React.createElement('label', { className: 'font-semibold text-gray-700' }, 'Criado em'),
                        React.createElement('p', null, utils.formatDateTime(template.created_at))
                    ),
                    
                    template.updated_at && React.createElement('div', null,
                        React.createElement('label', { className: 'font-semibold text-gray-700' }, 'Atualizado em'),
                        React.createElement('p', null, utils.formatDateTime(template.updated_at))
                    )
                )
            ),
            React.createElement('div', { className: 'modal-footer' },
                template.status === 'draft' && React.createElement('button', {
                    className: 'btn btn-primary',
                    onClick: () => {
                        onSubmit(template.id);
                        onClose();
                    }
                }, 'Enviar para Aprovação'),
                React.createElement('button', {
                    className: 'btn btn-secondary',
                    onClick: onClose
                }, 'Fechar')
            )
        )
    );
};