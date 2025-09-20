// Contacts component for Phase 3 CRM implementation
const { useState, useEffect } = React;

const Contacts = () => {
    const [contacts, setContacts] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [filters, setFilters] = useState({
        search: '',
        tag: '',
        limit: 20,
        offset: 0
    });
    const [showCreateModal, setShowCreateModal] = useState(false);
    const [selectedContact, setSelectedContact] = useState(null);
    const [showDetailModal, setShowDetailModal] = useState(false);
    const [availableTags, setAvailableTags] = useState(['lead', 'cliente', 'prospect', 'vip']);

    const loadContacts = async () => {
        try {
            setLoading(true);
            setError(null);
            const response = await API.contacts.list(filters);
            setContacts(response.contacts || []);
        } catch (err) {
            console.error('Error loading contacts:', err);
            setError(err.message);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        loadContacts();
    }, [filters]);

    const handleFilterChange = (key, value) => {
        setFilters(prev => ({
            ...prev,
            [key]: value,
            offset: 0 // Reset pagination when filters change
        }));
    };

    const handleCreateContact = async (contactData) => {
        try {
            await API.contacts.create(contactData);
            utils.showToast('Contato criado com sucesso!', 'success');
            setShowCreateModal(false);
            loadContacts();
        } catch (err) {
            utils.showToast(`Erro ao criar contato: ${err.message}`, 'error');
        }
    };

    const handleViewContact = (contact) => {
        setSelectedContact(contact);
        setShowDetailModal(true);
    };

    const handleAddTag = async (contactId, tag) => {
        try {
            await API.contacts.addTags(contactId, [tag]);
            utils.showToast('Tag adicionada com sucesso!', 'success');
            loadContacts();
        } catch (err) {
            utils.showToast(`Erro ao adicionar tag: ${err.message}`, 'error');
        }
    };

    if (loading && contacts.length === 0) {
        return React.createElement('div', { className: 'flex items-center justify-center h-64' },
            React.createElement('div', { className: 'text-center' },
                React.createElement('div', { className: 'spinner mb-4' }),
                React.createElement('p', { className: 'text-gray-600' }, 'Carregando contatos...')
            )
        );
    }

    return React.createElement('div', null,
        // Page header
        React.createElement('div', { className: 'page-header' },
            React.createElement('h2', { className: 'page-title' }, 'Contatos'),
            React.createElement('p', { className: 'page-subtitle' }, 
                'Gerencie sua base de contatos e leads'
            ),
            React.createElement('div', { className: 'page-actions' },
                React.createElement('button', {
                    className: 'btn btn-secondary btn-sm',
                    onClick: loadContacts
                },
                    React.createElement('i', { className: 'fas fa-sync-alt mr-2' }),
                    'Atualizar'
                ),
                React.createElement('button', {
                    className: 'btn btn-secondary',
                    onClick: () => utils.showToast('Funcionalidade em desenvolvimento', 'info')
                },
                    React.createElement('i', { className: 'fas fa-upload mr-2' }),
                    'Importar'
                ),
                React.createElement('button', {
                    className: 'btn btn-primary',
                    onClick: () => setShowCreateModal(true)
                },
                    React.createElement('i', { className: 'fas fa-plus mr-2' }),
                    'Novo Contato'
                )
            )
        ),

        // Filters
        React.createElement('div', { className: 'card mb-6' },
            React.createElement('div', { className: 'card-body' },
                React.createElement('div', { className: 'grid grid-cols-1 md:grid-cols-3 gap-4' },
                    React.createElement('div', null,
                        React.createElement('label', { className: 'input-label' }, 'Buscar'),
                        React.createElement('input', {
                            type: 'text',
                            className: 'input',
                            placeholder: 'Nome, telefone ou email...',
                            value: filters.search,
                            onChange: (e) => handleFilterChange('search', e.target.value)
                        })
                    ),
                    React.createElement('div', null,
                        React.createElement('label', { className: 'input-label' }, 'Tag'),
                        React.createElement('select', {
                            className: 'input select',
                            value: filters.tag,
                            onChange: (e) => handleFilterChange('tag', e.target.value)
                        },
                            React.createElement('option', { value: '' }, 'Todas as tags'),
                            availableTags.map(tag =>
                                React.createElement('option', { key: tag, value: tag }, 
                                    tag.charAt(0).toUpperCase() + tag.slice(1)
                                )
                            )
                        )
                    ),
                    React.createElement('div', { className: 'flex items-end' },
                        React.createElement('button', {
                            className: 'btn btn-secondary w-full',
                            onClick: () => setFilters({
                                search: '',
                                tag: '',
                                limit: 20,
                                offset: 0
                            })
                        }, 'Limpar Filtros')
                    )
                )
            )
        ),

        // Contacts table
        React.createElement('div', { className: 'data-table' },
            React.createElement('div', { className: 'table-header' },
                React.createElement('h3', { className: 'table-title' }, 'Lista de Contatos'),
                React.createElement('div', { className: 'table-filters' },
                    React.createElement('span', { className: 'text-sm text-gray-600' },
                        `${contacts.length} contatos`
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
                contacts.length > 0 ? React.createElement('table', { className: 'table' },
                    React.createElement('thead', null,
                        React.createElement('tr', null,
                            React.createElement('th', null, 'Nome'),
                            React.createElement('th', null, 'Contato'),
                            React.createElement('th', null, 'Tags'),
                            React.createElement('th', null, 'Última interação'),
                            React.createElement('th', null, 'Ações')
                        )
                    ),
                    React.createElement('tbody', null,
                        contacts.map(contact =>
                            React.createElement('tr', { key: contact.id },
                                React.createElement('td', null,
                                    React.createElement('div', { className: 'flex items-center gap-3' },
                                        React.createElement('div', { 
                                            className: 'avatar bg-primary-500',
                                            title: contact.first_name + ' ' + (contact.last_name || '')
                                        }, 
                                            (contact.first_name || 'U').charAt(0).toUpperCase()
                                        ),
                                        React.createElement('div', null,
                                            React.createElement('div', { className: 'font-medium' },
                                                `${contact.first_name || 'Unnamed'} ${contact.last_name || ''}`
                                            ),
                                            contact.email && React.createElement('div', { 
                                                className: 'text-sm text-gray-500' 
                                            }, contact.email)
                                        )
                                    )
                                ),
                                React.createElement('td', null,
                                    React.createElement('div', null,
                                        contact.phone && React.createElement('div', { className: 'font-medium' },
                                            utils.formatPhoneNumber(contact.phone)
                                        ),
                                        contact.whatsapp_number && React.createElement('div', { 
                                            className: 'text-sm text-gray-500 flex items-center gap-1' 
                                        },
                                            React.createElement('i', { className: 'fab fa-whatsapp text-green-500' }),
                                            utils.formatPhoneNumber(contact.whatsapp_number)
                                        )
                                    )
                                ),
                                React.createElement('td', null,
                                    React.createElement('div', { className: 'flex flex-wrap gap-1' },
                                        (contact.tags || []).map(tag =>
                                            React.createElement('span', {
                                                key: tag,
                                                className: 'badge badge-primary text-xs'
                                            }, tag)
                                        )
                                    )
                                ),
                                React.createElement('td', null,
                                    React.createElement('div', { className: 'text-sm' },
                                        contact.updated_at ? 
                                            utils.getRelativeTime(contact.updated_at) : 
                                            'Nunca'
                                    )
                                ),
                                React.createElement('td', null,
                                    React.createElement('div', { className: 'action-buttons' },
                                        React.createElement('button', {
                                            className: 'action-btn view',
                                            title: 'Ver detalhes',
                                            onClick: () => handleViewContact(contact)
                                        },
                                            React.createElement('i', { className: 'fas fa-eye' })
                                        ),
                                        React.createElement('button', {
                                            className: 'action-btn edit',
                                            title: 'Editar contato',
                                            onClick: () => utils.showToast('Funcionalidade em desenvolvimento', 'info')
                                        },
                                            React.createElement('i', { className: 'fas fa-edit' })
                                        )
                                    )
                                )
                            )
                        )
                    )
                ) : React.createElement('div', { className: 'empty-state' },
                    React.createElement('i', { className: 'fas fa-address-book empty-state-icon' }),
                    React.createElement('h3', { className: 'empty-state-title' }, 'Nenhum contato encontrado'),
                    React.createElement('p', { className: 'empty-state-description' }, 
                        'Comece adicionando seu primeiro contato'
                    ),
                    React.createElement('button', {
                        className: 'btn btn-primary',
                        onClick: () => setShowCreateModal(true)
                    },
                        React.createElement('i', { className: 'fas fa-plus mr-2' }),
                        'Adicionar contato'
                    )
                )
            )
        ),

        // Create Contact Modal
        showCreateModal && React.createElement(CreateContactModal, {
            onClose: () => setShowCreateModal(false),
            onCreate: handleCreateContact,
            availableTags
        }),

        // Contact Detail Modal
        showDetailModal && selectedContact && React.createElement(ContactDetailModal, {
            contact: selectedContact,
            onClose: () => {
                setShowDetailModal(false);
                setSelectedContact(null);
            },
            onAddTag: handleAddTag,
            availableTags
        })
    );
};

// Create Contact Modal Component
const CreateContactModal = ({ onClose, onCreate, availableTags }) => {
    const [formData, setFormData] = useState({
        first_name: '',
        last_name: '',
        phone: '',
        whatsapp_number: '',
        email: '',
        company: '',
        position: '',
        tags: []
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

    const handleTagToggle = (tag) => {
        setFormData(prev => ({
            ...prev,
            tags: prev.tags.includes(tag) 
                ? prev.tags.filter(t => t !== tag)
                : [...prev.tags, tag]
        }));
    };

    return React.createElement('div', { className: 'modal-overlay', onClick: onClose },
        React.createElement('div', { 
            className: 'modal', 
            onClick: (e) => e.stopPropagation(),
            style: { maxWidth: '600px' }
        },
            React.createElement('div', { className: 'modal-header' },
                React.createElement('h3', { className: 'text-lg font-semibold' }, 'Novo Contato'),
                React.createElement('button', {
                    className: 'text-gray-500 hover:text-gray-700',
                    onClick: onClose
                },
                    React.createElement('i', { className: 'fas fa-times' })
                )
            ),
            React.createElement('form', { onSubmit: handleSubmit },
                React.createElement('div', { className: 'modal-body' },
                    React.createElement('div', { className: 'grid grid-cols-1 md:grid-cols-2 gap-4' },
                        React.createElement('div', { className: 'input-group' },
                            React.createElement('label', { className: 'input-label' }, 'Nome *'),
                            React.createElement('input', {
                                type: 'text',
                                className: 'input',
                                value: formData.first_name,
                                onChange: (e) => handleChange('first_name', e.target.value),
                                required: true
                            })
                        ),
                        React.createElement('div', { className: 'input-group' },
                            React.createElement('label', { className: 'input-label' }, 'Sobrenome'),
                            React.createElement('input', {
                                type: 'text',
                                className: 'input',
                                value: formData.last_name,
                                onChange: (e) => handleChange('last_name', e.target.value)
                            })
                        ),
                        React.createElement('div', { className: 'input-group' },
                            React.createElement('label', { className: 'input-label' }, 'Telefone'),
                            React.createElement('input', {
                                type: 'tel',
                                className: 'input',
                                placeholder: '+55 11 99999-9999',
                                value: formData.phone,
                                onChange: (e) => handleChange('phone', e.target.value)
                            })
                        ),
                        React.createElement('div', { className: 'input-group' },
                            React.createElement('label', { className: 'input-label' }, 'WhatsApp'),
                            React.createElement('input', {
                                type: 'tel',
                                className: 'input',
                                placeholder: '+55 11 99999-9999',
                                value: formData.whatsapp_number,
                                onChange: (e) => handleChange('whatsapp_number', e.target.value)
                            })
                        )
                    ),
                    React.createElement('div', { className: 'input-group' },
                        React.createElement('label', { className: 'input-label' }, 'Email'),
                        React.createElement('input', {
                            type: 'email',
                            className: 'input',
                            value: formData.email,
                            onChange: (e) => handleChange('email', e.target.value)
                        })
                    ),
                    React.createElement('div', { className: 'grid grid-cols-1 md:grid-cols-2 gap-4' },
                        React.createElement('div', { className: 'input-group' },
                            React.createElement('label', { className: 'input-label' }, 'Empresa'),
                            React.createElement('input', {
                                type: 'text',
                                className: 'input',
                                value: formData.company,
                                onChange: (e) => handleChange('company', e.target.value)
                            })
                        ),
                        React.createElement('div', { className: 'input-group' },
                            React.createElement('label', { className: 'input-label' }, 'Cargo'),
                            React.createElement('input', {
                                type: 'text',
                                className: 'input',
                                value: formData.position,
                                onChange: (e) => handleChange('position', e.target.value)
                            })
                        )
                    ),
                    React.createElement('div', { className: 'input-group' },
                        React.createElement('label', { className: 'input-label' }, 'Tags'),
                        React.createElement('div', { className: 'flex flex-wrap gap-2 mt-2' },
                            availableTags.map(tag =>
                                React.createElement('button', {
                                    key: tag,
                                    type: 'button',
                                    className: `btn btn-sm ${formData.tags.includes(tag) ? 'btn-primary' : 'btn-secondary'}`,
                                    onClick: () => handleTagToggle(tag)
                                },
                                    tag.charAt(0).toUpperCase() + tag.slice(1)
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
                        creating ? 'Criando...' : 'Criar Contato'
                    )
                )
            )
        )
    );
};

// Contact Detail Modal Component
const ContactDetailModal = ({ contact, onClose, onAddTag, availableTags }) => {
    return React.createElement('div', { className: 'modal-overlay', onClick: onClose },
        React.createElement('div', { 
            className: 'modal', 
            onClick: (e) => e.stopPropagation(),
            style: { maxWidth: '600px' }
        },
            React.createElement('div', { className: 'modal-header' },
                React.createElement('h3', { className: 'text-lg font-semibold' }, 'Detalhes do Contato'),
                React.createElement('button', {
                    className: 'text-gray-500 hover:text-gray-700',
                    onClick: onClose
                },
                    React.createElement('i', { className: 'fas fa-times' })
                )
            ),
            React.createElement('div', { className: 'modal-body' },
                React.createElement('div', { className: 'space-y-4' },
                    React.createElement('div', { className: 'flex items-center gap-4' },
                        React.createElement('div', { 
                            className: 'avatar avatar-lg bg-primary-500' 
                        }, (contact.first_name || 'U').charAt(0).toUpperCase()),
                        React.createElement('div', null,
                            React.createElement('h4', { className: 'text-xl font-semibold' },
                                `${contact.first_name || 'Unnamed'} ${contact.last_name || ''}`
                            ),
                            contact.position && contact.company && React.createElement('p', { 
                                className: 'text-gray-600' 
                            }, `${contact.position} na ${contact.company}`)
                        )
                    ),
                    React.createElement('div', { className: 'grid grid-cols-1 md:grid-cols-2 gap-4' },
                        contact.phone && React.createElement('div', null,
                            React.createElement('label', { className: 'font-semibold text-gray-700' }, 'Telefone'),
                            React.createElement('p', null, utils.formatPhoneNumber(contact.phone))
                        ),
                        contact.whatsapp_number && React.createElement('div', null,
                            React.createElement('label', { className: 'font-semibold text-gray-700' }, 'WhatsApp'),
                            React.createElement('p', { className: 'flex items-center gap-2' },
                                React.createElement('i', { className: 'fab fa-whatsapp text-green-500' }),
                                utils.formatPhoneNumber(contact.whatsapp_number)
                            )
                        ),
                        contact.email && React.createElement('div', null,
                            React.createElement('label', { className: 'font-semibold text-gray-700' }, 'Email'),
                            React.createElement('p', null, contact.email)
                        ),
                        contact.company && React.createElement('div', null,
                            React.createElement('label', { className: 'font-semibold text-gray-700' }, 'Empresa'),
                            React.createElement('p', null, contact.company)
                        )
                    ),
                    React.createElement('div', null,
                        React.createElement('label', { className: 'font-semibold text-gray-700' }, 'Tags'),
                        React.createElement('div', { className: 'flex flex-wrap gap-2 mt-2' },
                            (contact.tags || []).map(tag =>
                                React.createElement('span', {
                                    key: tag,
                                    className: 'badge badge-primary'
                                }, tag)
                            ),
                            contact.tags?.length === 0 && React.createElement('p', { 
                                className: 'text-gray-500 italic' 
                            }, 'Nenhuma tag atribuída')
                        )
                    ),
                    React.createElement('div', null,
                        React.createElement('label', { className: 'font-semibold text-gray-700' }, 'Criado em'),
                        React.createElement('p', null, utils.formatDateTime(contact.created_at))
                    )
                )
            ),
            React.createElement('div', { className: 'modal-footer' },
                React.createElement('button', {
                    className: 'btn btn-secondary',
                    onClick: () => utils.showToast('Funcionalidade em desenvolvimento', 'info')
                }, 'Editar'),
                React.createElement('button', {
                    className: 'btn btn-secondary',
                    onClick: onClose
                }, 'Fechar')
            )
        )
    );
};