// Messages component for Phase 2 implementation
const { useState, useEffect } = React;

const Messages = () => {
    const [messages, setMessages] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [filters, setFilters] = useState({
        status: '',
        message_type: '',
        date_from: '',
        date_to: '',
        limit: 20,
        offset: 0
    });
    const [showSendModal, setShowSendModal] = useState(false);
    const [selectedMessage, setSelectedMessage] = useState(null);
    const [showDetailModal, setShowDetailModal] = useState(false);

    const loadMessages = async () => {
        try {
            setLoading(true);
            setError(null);
            const response = await API.messages.list(filters);
            setMessages(response.messages || []);
        } catch (err) {
            console.error('Error loading messages:', err);
            setError(err.message);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        loadMessages();
    }, [filters]);

    const handleFilterChange = (key, value) => {
        setFilters(prev => ({
            ...prev,
            [key]: value,
            offset: 0 // Reset pagination when filters change
        }));
    };

    const handleSendMessage = async (messageData) => {
        try {
            await API.messages.send(messageData);
            utils.showToast('Mensagem enviada com sucesso!', 'success');
            setShowSendModal(false);
            loadMessages();
        } catch (err) {
            utils.showToast(`Erro ao enviar mensagem: ${err.message}`, 'error');
        }
    };

    const handleViewMessage = (message) => {
        setSelectedMessage(message);
        setShowDetailModal(true);
    };

    if (loading && messages.length === 0) {
        return React.createElement('div', { className: 'flex items-center justify-center h-64' },
            React.createElement('div', { className: 'text-center' },
                React.createElement('div', { className: 'spinner mb-4' }),
                React.createElement('p', { className: 'text-gray-600' }, 'Carregando mensagens...')
            )
        );
    }

    return React.createElement('div', null,
        // Page header
        React.createElement('div', { className: 'page-header' },
            React.createElement('h2', { className: 'page-title' }, 'Mensagens'),
            React.createElement('p', { className: 'page-subtitle' }, 
                'Gerencie e monitore todas as mensagens enviadas'
            ),
            React.createElement('div', { className: 'page-actions' },
                React.createElement('button', {
                    className: 'btn btn-secondary btn-sm',
                    onClick: loadMessages
                },
                    React.createElement('i', { className: 'fas fa-sync-alt mr-2' }),
                    'Atualizar'
                ),
                React.createElement('button', {
                    className: 'btn btn-primary',
                    onClick: () => setShowSendModal(true)
                },
                    React.createElement('i', { className: 'fas fa-paper-plane mr-2' }),
                    'Enviar Mensagem'
                )
            )
        ),

        // Filters
        React.createElement('div', { className: 'card mb-6' },
            React.createElement('div', { className: 'card-body' },
                React.createElement('div', { className: 'grid grid-cols-1 md:grid-cols-5 gap-4' },
                    React.createElement('div', null,
                        React.createElement('label', { className: 'input-label' }, 'Status'),
                        React.createElement('select', {
                            className: 'input select',
                            value: filters.status,
                            onChange: (e) => handleFilterChange('status', e.target.value)
                        },
                            React.createElement('option', { value: '' }, 'Todos'),
                            React.createElement('option', { value: 'queued' }, 'Na fila'),
                            React.createElement('option', { value: 'sending' }, 'Enviando'),
                            React.createElement('option', { value: 'sent' }, 'Enviada'),
                            React.createElement('option', { value: 'delivered' }, 'Entregue'),
                            React.createElement('option', { value: 'read' }, 'Lida'),
                            React.createElement('option', { value: 'failed' }, 'Falhou')
                        )
                    ),
                    React.createElement('div', null,
                        React.createElement('label', { className: 'input-label' }, 'Tipo'),
                        React.createElement('select', {
                            className: 'input select',
                            value: filters.message_type,
                            onChange: (e) => handleFilterChange('message_type', e.target.value)
                        },
                            React.createElement('option', { value: '' }, 'Todos'),
                            React.createElement('option', { value: 'text' }, 'Texto'),
                            React.createElement('option', { value: 'image' }, 'Imagem'),
                            React.createElement('option', { value: 'video' }, 'Vídeo'),
                            React.createElement('option', { value: 'audio' }, 'Áudio'),
                            React.createElement('option', { value: 'document' }, 'Documento'),
                            React.createElement('option', { value: 'location' }, 'Localização')
                        )
                    ),
                    React.createElement('div', null,
                        React.createElement('label', { className: 'input-label' }, 'Data de'),
                        React.createElement('input', {
                            type: 'date',
                            className: 'input',
                            value: filters.date_from,
                            onChange: (e) => handleFilterChange('date_from', e.target.value)
                        })
                    ),
                    React.createElement('div', null,
                        React.createElement('label', { className: 'input-label' }, 'Data até'),
                        React.createElement('input', {
                            type: 'date',
                            className: 'input',
                            value: filters.date_to,
                            onChange: (e) => handleFilterChange('date_to', e.target.value)
                        })
                    ),
                    React.createElement('div', { className: 'flex items-end' },
                        React.createElement('button', {
                            className: 'btn btn-secondary w-full',
                            onClick: () => setFilters({
                                status: '',
                                message_type: '',
                                date_from: '',
                                date_to: '',
                                limit: 20,
                                offset: 0
                            })
                        }, 'Limpar Filtros')
                    )
                )
            )
        ),

        // Messages table
        React.createElement('div', { className: 'data-table' },
            React.createElement('div', { className: 'table-header' },
                React.createElement('h3', { className: 'table-title' }, 'Mensagens'),
                React.createElement('div', { className: 'table-filters' },
                    React.createElement('span', { className: 'text-sm text-gray-600' },
                        `${messages.length} mensagens`
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
                messages.length > 0 ? React.createElement('table', { className: 'table' },
                    React.createElement('thead', null,
                        React.createElement('tr', null,
                            React.createElement('th', null, 'Destinatário'),
                            React.createElement('th', null, 'Tipo'),
                            React.createElement('th', null, 'Conteúdo'),
                            React.createElement('th', null, 'Status'),
                            React.createElement('th', null, 'Data'),
                            React.createElement('th', null, 'Ações')
                        )
                    ),
                    React.createElement('tbody', null,
                        messages.map(message =>
                            React.createElement('tr', { key: message.id },
                                React.createElement('td', null,
                                    React.createElement('div', { className: 'font-medium' },
                                        utils.formatPhoneNumber(message.to_number || message.to_number_e164)
                                    )
                                ),
                                React.createElement('td', null,
                                    React.createElement('div', { className: 'flex items-center gap-2' },
                                        React.createElement('i', { 
                                            className: `${utils.getMessageTypeIcon(message.message_type)} text-gray-500` 
                                        }),
                                        React.createElement('span', { className: 'capitalize' }, 
                                            message.message_type
                                        )
                                    )
                                ),
                                React.createElement('td', null,
                                    React.createElement('div', { className: 'max-w-xs truncate' },
                                        message.content_text || message.caption || 'Mídia'
                                    )
                                ),
                                React.createElement('td', null,
                                    React.createElement('span', { 
                                        className: `badge ${utils.getStatusBadge(message.status)}` 
                                    }, utils.getStatusText(message.status))
                                ),
                                React.createElement('td', null,
                                    React.createElement('div', { className: 'text-sm' },
                                        utils.getRelativeTime(message.created_at)
                                    )
                                ),
                                React.createElement('td', null,
                                    React.createElement('div', { className: 'action-buttons' },
                                        React.createElement('button', {
                                            className: 'action-btn view',
                                            title: 'Ver detalhes',
                                            onClick: () => handleViewMessage(message)
                                        },
                                            React.createElement('i', { className: 'fas fa-eye' })
                                        )
                                    )
                                )
                            )
                        )
                    )
                ) : React.createElement('div', { className: 'empty-state' },
                    React.createElement('i', { className: 'fas fa-comment-dots empty-state-icon' }),
                    React.createElement('h3', { className: 'empty-state-title' }, 'Nenhuma mensagem encontrada'),
                    React.createElement('p', { className: 'empty-state-description' }, 
                        'Ainda não há mensagens com os filtros selecionados'
                    ),
                    React.createElement('button', {
                        className: 'btn btn-primary',
                        onClick: () => setShowSendModal(true)
                    },
                        React.createElement('i', { className: 'fas fa-paper-plane mr-2' }),
                        'Enviar primeira mensagem'
                    )
                )
            )
        ),

        // Send Message Modal
        showSendModal && React.createElement(SendMessageModal, {
            onClose: () => setShowSendModal(false),
            onSend: handleSendMessage
        }),

        // Message Detail Modal
        showDetailModal && selectedMessage && React.createElement(MessageDetailModal, {
            message: selectedMessage,
            onClose: () => {
                setShowDetailModal(false);
                setSelectedMessage(null);
            }
        })
    );
};

// Send Message Modal Component
const SendMessageModal = ({ onClose, onSend }) => {
    const [formData, setFormData] = useState({
        to_number: '',
        message_type: 'text',
        content_text: '',
        media_url: '',
        caption: ''
    });
    const [sending, setSending] = useState(false);

    const handleSubmit = async (e) => {
        e.preventDefault();
        setSending(true);
        try {
            await onSend(formData);
        } finally {
            setSending(false);
        }
    };

    const handleChange = (key, value) => {
        setFormData(prev => ({ ...prev, [key]: value }));
    };

    return React.createElement('div', { className: 'modal-overlay', onClick: onClose },
        React.createElement('div', { 
            className: 'modal', 
            onClick: (e) => e.stopPropagation() 
        },
            React.createElement('div', { className: 'modal-header' },
                React.createElement('h3', { className: 'text-lg font-semibold' }, 'Enviar Mensagem'),
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
                        React.createElement('label', { className: 'input-label' }, 'Número do destinatário'),
                        React.createElement('input', {
                            type: 'tel',
                            className: 'input',
                            placeholder: '+55 11 99999-9999',
                            value: formData.to_number,
                            onChange: (e) => handleChange('to_number', e.target.value),
                            required: true
                        })
                    ),
                    React.createElement('div', { className: 'input-group' },
                        React.createElement('label', { className: 'input-label' }, 'Tipo da mensagem'),
                        React.createElement('select', {
                            className: 'input select',
                            value: formData.message_type,
                            onChange: (e) => handleChange('message_type', e.target.value)
                        },
                            React.createElement('option', { value: 'text' }, 'Texto'),
                            React.createElement('option', { value: 'image' }, 'Imagem'),
                            React.createElement('option', { value: 'video' }, 'Vídeo'),
                            React.createElement('option', { value: 'audio' }, 'Áudio'),
                            React.createElement('option', { value: 'document' }, 'Documento')
                        )
                    ),
                    formData.message_type === 'text' && React.createElement('div', { className: 'input-group' },
                        React.createElement('label', { className: 'input-label' }, 'Mensagem'),
                        React.createElement('textarea', {
                            className: 'input textarea',
                            rows: 4,
                            placeholder: 'Digite sua mensagem...',
                            value: formData.content_text,
                            onChange: (e) => handleChange('content_text', e.target.value),
                            required: formData.message_type === 'text'
                        })
                    ),
                    formData.message_type !== 'text' && React.createElement('div', null,
                        React.createElement('div', { className: 'input-group' },
                            React.createElement('label', { className: 'input-label' }, 'URL da mídia'),
                            React.createElement('input', {
                                type: 'url',
                                className: 'input',
                                placeholder: 'https://exemplo.com/arquivo.jpg',
                                value: formData.media_url,
                                onChange: (e) => handleChange('media_url', e.target.value),
                                required: formData.message_type !== 'text'
                            })
                        ),
                        React.createElement('div', { className: 'input-group' },
                            React.createElement('label', { className: 'input-label' }, 'Legenda (opcional)'),
                            React.createElement('textarea', {
                                className: 'input textarea',
                                rows: 2,
                                placeholder: 'Adicione uma legenda...',
                                value: formData.caption,
                                onChange: (e) => handleChange('caption', e.target.value)
                            })
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
                        disabled: sending
                    },
                        sending && React.createElement('div', { className: 'spinner mr-2' }),
                        sending ? 'Enviando...' : 'Enviar'
                    )
                )
            )
        )
    );
};

// Message Detail Modal Component
const MessageDetailModal = ({ message, onClose }) => {
    return React.createElement('div', { className: 'modal-overlay', onClick: onClose },
        React.createElement('div', { 
            className: 'modal', 
            onClick: (e) => e.stopPropagation() 
        },
            React.createElement('div', { className: 'modal-header' },
                React.createElement('h3', { className: 'text-lg font-semibold' }, 'Detalhes da Mensagem'),
                React.createElement('button', {
                    className: 'text-gray-500 hover:text-gray-700',
                    onClick: onClose
                },
                    React.createElement('i', { className: 'fas fa-times' })
                )
            ),
            React.createElement('div', { className: 'modal-body' },
                React.createElement('div', { className: 'space-y-4' },
                    React.createElement('div', null,
                        React.createElement('label', { className: 'font-semibold text-gray-700' }, 'ID da Mensagem'),
                        React.createElement('p', { className: 'text-sm font-mono text-gray-600' }, message.id)
                    ),
                    React.createElement('div', null,
                        React.createElement('label', { className: 'font-semibold text-gray-700' }, 'Destinatário'),
                        React.createElement('p', null, utils.formatPhoneNumber(message.to_number || message.to_number_e164))
                    ),
                    React.createElement('div', null,
                        React.createElement('label', { className: 'font-semibold text-gray-700' }, 'Tipo'),
                        React.createElement('p', null,
                            React.createElement('span', { 
                                className: `badge ${utils.getStatusBadge(message.message_type)}` 
                            }, message.message_type)
                        )
                    ),
                    React.createElement('div', null,
                        React.createElement('label', { className: 'font-semibold text-gray-700' }, 'Status'),
                        React.createElement('p', null,
                            React.createElement('span', { 
                                className: `badge ${utils.getStatusBadge(message.status)}` 
                            }, utils.getStatusText(message.status))
                        )
                    ),
                    message.content_text && React.createElement('div', null,
                        React.createElement('label', { className: 'font-semibold text-gray-700' }, 'Conteúdo'),
                        React.createElement('p', { className: 'bg-gray-50 p-3 rounded border' }, message.content_text)
                    ),
                    React.createElement('div', null,
                        React.createElement('label', { className: 'font-semibold text-gray-700' }, 'Criado em'),
                        React.createElement('p', null, utils.formatDateTime(message.created_at))
                    ),
                    message.updated_at && React.createElement('div', null,
                        React.createElement('label', { className: 'font-semibold text-gray-700' }, 'Atualizado em'),
                        React.createElement('p', null, utils.formatDateTime(message.updated_at))
                    )
                )
            ),
            React.createElement('div', { className: 'modal-footer' },
                React.createElement('button', {
                    className: 'btn btn-secondary',
                    onClick: onClose
                }, 'Fechar')
            )
        )
    );
};